import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing central Supabase environment variables.");
      return json({ ok: false, error: "Central configuration missing." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const businessKey = String(body?.business_key || "").trim();
    const businessToken = String(body?.business_token || "").trim();
    const requestedName = String(body?.requested_name || "").trim();

    if (!businessKey || !businessToken || !requestedName) {
      return json(
        { ok: false, error: "business_key, business_token ve requested_name gerekli." },
        400,
      );
    }

    if (requestedName.length < 2 || requestedName.length > 80) {
      return json(
        { ok: false, error: "Dükkan adı 2 ile 80 karakter arasında olmalı." },
        400,
      );
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: business, error: businessError } = await db
      .from("businesses")
      .select("id,public_key,shop_name,api_token_hash")
      .eq("public_key", businessKey)
      .maybeSingle();

    if (businessError) {
      console.error("Business lookup failed:", businessError);
      return json({ ok: false, error: "İşletme doğrulanamadı." }, 500);
    }

    if (!business) {
      return json({ ok: false, error: "İşletme bulunamadı." }, 404);
    }

    const tokenHash = await sha256Hex(businessToken);
    if (tokenHash !== business.api_token_hash) {
      console.warn("Invalid business token:", { businessKey });
      return json({ ok: false, error: "Business token geçersiz." }, 401);
    }

    const currentName = String(business.shop_name || "").trim();

    if (currentName.localeCompare(requestedName, "tr", { sensitivity: "base" }) === 0) {
      return json(
        { ok: false, error: "Yeni dükkan adı mevcut dükkan adı ile aynı olamaz." },
        409,
      );
    }

    const { data: duplicateBusiness, error: duplicateBusinessError } = await db
      .from("businesses")
      .select("id,shop_name")
      .ilike("shop_name", requestedName)
      .neq("id", business.id)
      .limit(1);

    if (duplicateBusinessError) {
      console.error("Duplicate business name check failed:", duplicateBusinessError);
      return json({ ok: false, error: "Dükkan adı kontrol edilemedi." }, 500);
    }

    if (duplicateBusiness && duplicateBusiness.length > 0) {
      return json({ ok: false, error: "Bu dükkan adı başka bir işletme tarafından kullanılıyor." }, 409);
    }

    const { data: duplicatePending, error: duplicatePendingError } = await db
      .from("name_change_requests")
      .select("id,business_id,requested_name")
      .eq("status", "pending")
      .ilike("requested_name", requestedName)
      .limit(1);

    if (duplicatePendingError) {
      console.error("Pending name check failed:", duplicatePendingError);
      return json({ ok: false, error: "Bekleyen isim talepleri kontrol edilemedi." }, 500);
    }

    if (duplicatePending && duplicatePending.length > 0) {
      const sameBusiness = duplicatePending[0].business_id === business.id;
      return json(
        {
          ok: false,
          error: sameBusiness
            ? "Bu işletme için aynı isimle bekleyen bir talep zaten var."
            : "Bu dükkan adı başka bir işletmenin bekleyen talebinde rezerve edilmiş.",
        },
        409,
      );
    }

    const { data: existingPending, error: existingPendingError } = await db
      .from("name_change_requests")
      .select("id,requested_name")
      .eq("business_id", business.id)
      .eq("status", "pending")
      .maybeSingle();

    if (existingPendingError) {
      console.error("Existing pending request check failed:", existingPendingError);
      return json({ ok: false, error: "Mevcut isim talebi kontrol edilemedi." }, 500);
    }

    if (existingPending) {
      return json(
        {
          ok: false,
          error: `Bu işletmenin zaten bekleyen bir isim talebi var: ${existingPending.requested_name}`,
        },
        409,
      );
    }

    const { data: inserted, error: insertError } = await db
      .from("name_change_requests")
      .insert({
        business_id: business.id,
        current_name: currentName,
        requested_name: requestedName,
        status: "pending",
      })
      .select("id,business_id,current_name,requested_name,status,requested_at")
      .single();

    if (insertError) {
      console.error("Name request insert failed:", insertError);
      return json(
        { ok: false, error: insertError.message || "İsim değişikliği talebi oluşturulamadı." },
        500,
      );
    }

    console.log("Name change request created:", {
      requestId: inserted.id,
      businessId: business.id,
      businessKey,
      currentName,
      requestedName,
    });

    return json({
      ok: true,
      request: inserted,
    });
  } catch (error) {
    console.error("tenant-name-request unexpected error:", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Beklenmeyen merkezi sunucu hatası.",
      },
      500,
    );
  }
});
