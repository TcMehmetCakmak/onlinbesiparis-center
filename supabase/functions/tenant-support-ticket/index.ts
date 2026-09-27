import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-platform-bridge-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok:false, error:"Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const expectedSecret = Deno.env.get("PLATFORM_BRIDGE_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !expectedSecret) {
      return json({ ok:false, error:"Merkezi sunucu yapılandırması eksik." }, 500);
    }

    const receivedSecret = req.headers.get("x-platform-bridge-secret") || "";
    if (!receivedSecret || !safeEqual(receivedSecret, expectedSecret)) {
      return json({ ok:false, error:"Yetkisiz platform isteği." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const businessId = String(body?.business_id || "").trim();
    const adminUserId = String(body?.admin_user_id || "").trim();

    if (!businessId) return json({ ok:false, error:"business_id gerekli." }, 400);

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth:{ persistSession:false, autoRefreshToken:false }
    });

    const { data: business, error: businessError } = await db
      .from("businesses")
      .select("id,shop_name")
      .eq("id", businessId)
      .maybeSingle();

    if (businessError) return json({ ok:false, error:"İşletme doğrulanamadı." }, 500);
    if (!business) return json({ ok:false, error:"İşletme bulunamadı." }, 404);

    if (action === "create") {
      const title = String(body?.title || "").trim();
      const detail = String(body?.detail || "").trim();
      if (!adminUserId) return json({ ok:false, error:"admin_user_id gerekli." }, 400);
      if (title.length < 3 || title.length > 160) {
        return json({ ok:false, error:"Başlık 3-160 karakter arasında olmalı." }, 400);
      }
      if (detail.length < 5 || detail.length > 5000) {
        return json({ ok:false, error:"Detay 5-5000 karakter arasında olmalı." }, 400);
      }

      const { data, error } = await db.from("support_tickets").insert({
        business_id: businessId,
        created_by_admin_user_id: adminUserId,
        title,
        detail,
        status:"pending"
      }).select("*").single();

      if (error) return json({ ok:false, error:error.message }, 500);
      return json({ ok:true, ticket:data });
    }

    if (action === "list") {
      const { data, error } = await db.from("support_tickets")
        .select("id,business_id,title,detail,status,resolution_note,created_at,sent_for_approval_at,completed_at,updated_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending:false });

      if (error) return json({ ok:false, error:error.message }, 500);
      return json({ ok:true, tickets:data || [] });
    }

    if (action === "complete") {
      const ticketId = Number(body?.ticket_id);
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return json({ ok:false, error:"Geçerli ticket_id gerekli." }, 400);
      }

      const { data, error } = await db.from("support_tickets")
        .update({
          status:"completed",
          completed_at:new Date().toISOString(),
          updated_at:new Date().toISOString()
        })
        .eq("id", ticketId)
        .eq("business_id", businessId)
        .eq("status","awaiting_admin_confirmation")
        .select("id,status,completed_at")
        .maybeSingle();

      if (error) return json({ ok:false, error:error.message }, 500);
      if (!data) {
        return json({ ok:false, error:"Talep bulunamadı veya admin onayına hazır değil." }, 409);
      }
      return json({ ok:true, ticket:data });
    }

    return json({ ok:false, error:"Geçersiz action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ ok:false, error:error instanceof Error ? error.message : "Beklenmeyen hata." }, 500);
  }
});
