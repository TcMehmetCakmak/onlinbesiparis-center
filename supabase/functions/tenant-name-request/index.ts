import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-platform-name-bridge-secret",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Sadece POST destekleniyor." }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const PLATFORM_NAME_BRIDGE_SECRET =
      Deno.env.get("PLATFORM_NAME_BRIDGE_SECRET");

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !PLATFORM_NAME_BRIDGE_SECRET
    ) {
      console.error("tenant-name-request: eksik secret");
      return json({
        ok: false,
        error: "Merkezi sunucu yapılandırması eksik.",
      }, 500);
    }

    const incomingSecret =
      req.headers.get("x-platform-name-bridge-secret") || "";

    if (
      !incomingSecret ||
      incomingSecret !== PLATFORM_NAME_BRIDGE_SECRET
    ) {
      console.warn("Geçersiz name bridge secret");
      return json({
        ok: false,
        error: "Yetkisiz isim talebi isteği.",
      }, 401);
    }

    const body = await req.json().catch(() => null);
    const businessId =
      String(body?.business_id ?? "").trim();
    const requestedName =
      String(body?.requested_name ?? "").trim();

    if (!businessId || !requestedName) {
      return json({
        ok: false,
        error: "business_id ve requested_name gerekli.",
      }, 400);
    }

    if (
      requestedName.length < 2 ||
      requestedName.length > 80
    ) {
      return json({
        ok: false,
        error: "Dükkan adı 2 ile 80 karakter arasında olmalı.",
      }, 400);
    }

    const db = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const { data: business, error: businessError } =
      await db
        .from("businesses")
        .select("id,shop_name")
        .eq("id", businessId)
        .maybeSingle();

    if (businessError) {
      console.error("Business lookup failed:", businessError);
      return json({
        ok: false,
        error: "İşletme doğrulanamadı.",
      }, 500);
    }

    if (!business) {
      return json({
        ok: false,
        error: "İşletme bulunamadı.",
      }, 404);
    }

    const currentName =
      String(business.shop_name || "").trim();

    if (
      currentName.localeCompare(
        requestedName,
        "tr",
        { sensitivity: "base" },
      ) === 0
    ) {
      return json({
        ok: false,
        error:
          "Yeni dükkan adı mevcut dükkan adı ile aynı olamaz.",
      }, 409);
    }

    const { data: duplicateBusiness, error: duplicateBusinessError } =
      await db
        .from("businesses")
        .select("id")
        .ilike("shop_name", requestedName)
        .neq("id", business.id)
        .limit(1);

    if (duplicateBusinessError) {
      console.error(
        "Duplicate business check failed:",
        duplicateBusinessError,
      );
      return json({
        ok: false,
        error: "Dükkan adı kontrol edilemedi.",
      }, 500);
    }

    if (duplicateBusiness?.length) {
      return json({
        ok: false,
        error:
          "Bu dükkan adı başka bir işletme tarafından kullanılıyor.",
      }, 409);
    }

    const { data: sameNamePending, error: sameNamePendingError } =
      await db
        .from("name_change_requests")
        .select("id,business_id,requested_name")
        .eq("status", "pending")
        .ilike("requested_name", requestedName)
        .limit(1);

    if (sameNamePendingError) {
      console.error(
        "Pending name check failed:",
        sameNamePendingError,
      );
      return json({
        ok: false,
        error:
          "Bekleyen isim talepleri kontrol edilemedi.",
      }, 500);
    }

    if (sameNamePending?.length) {
      const sameBusiness =
        String(sameNamePending[0].business_id) ===
        String(business.id);

      return json({
        ok: false,
        error: sameBusiness
          ? "Bu işletme için aynı isimle bekleyen bir talep zaten var."
          : "Bu dükkan adı başka bir işletmenin bekleyen talebinde rezerve edilmiş.",
      }, 409);
    }

    const { data: existingPending, error: existingPendingError } =
      await db
        .from("name_change_requests")
        .select("id,requested_name")
        .eq("business_id", business.id)
        .eq("status", "pending")
        .limit(1);

    if (existingPendingError) {
      console.error(
        "Existing pending check failed:",
        existingPendingError,
      );
      return json({
        ok: false,
        error: "Mevcut isim talebi kontrol edilemedi.",
      }, 500);
    }

    if (existingPending?.length) {
      return json({
        ok: false,
        error:
          `Bu işletmenin zaten bekleyen bir isim talebi var: ${existingPending[0].requested_name}`,
      }, 409);
    }

    const { data: inserted, error: insertError } =
      await db
        .from("name_change_requests")
        .insert({
          business_id: business.id,
          current_name: currentName,
          requested_name: requestedName,
          status: "pending",
        })
        .select(
          "id,business_id,current_name,requested_name,status,requested_at",
        )
        .single();

    if (insertError) {
      console.error("Name request insert failed:", insertError);
      return json({
        ok: false,
        error:
          insertError.message ||
          "İsim değişikliği talebi oluşturulamadı.",
      }, 500);
    }

    console.log("Name change request created", {
      requestId: inserted.id,
      businessId: business.id,
      requestedName,
    });

    return json({
      ok: true,
      request: inserted,
    });
  } catch (error) {
    console.error(
      "tenant-name-request unexpected error:",
      error,
    );

    return json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Beklenmeyen merkezi sunucu hatası.",
    }, 500);
  }
});
