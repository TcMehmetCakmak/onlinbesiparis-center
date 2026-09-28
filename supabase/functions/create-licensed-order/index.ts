import { createClient } from "npm:@supabase/supabase-js@2";

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


async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const PLATFORM_CONTROL_URL = Deno.env.get("PLATFORM_CONTROL_URL");
    const PLATFORM_CONTROL_PUBLISHABLE_KEY = Deno.env.get("PLATFORM_CONTROL_PUBLISHABLE_KEY");
    const PLATFORM_BUSINESS_KEY = Deno.env.get("PLATFORM_BUSINESS_KEY");

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !PLATFORM_CONTROL_URL ||
      !PLATFORM_CONTROL_PUBLISHABLE_KEY ||
      !PLATFORM_BUSINESS_KEY
    ) {
      return json({
        ok: false,
        error: "Sunucu yapılandırması eksik. Edge Function secret ayarlarını kontrol edin.",
      }, 500);
    }

    const platform = createClient(
      PLATFORM_CONTROL_URL,
      PLATFORM_CONTROL_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: business, error: businessError } = await platform
      .from("business_public")
      .select("business_id,public_key,shop_name,slug,license_end_date,manual_enabled,is_active")
      .eq("public_key", PLATFORM_BUSINESS_KEY)
      .maybeSingle();

    if (businessError) {
      console.error("Merkezi işletme sorgu hatası:", businessError);
      return json({ ok: false, error: "İşletme lisans bilgisi kontrol edilemedi." }, 502);
    }

    if (!business) {
      return json({ ok: false, error: "Merkezi işletme kaydı bulunamadı." }, 404);
    }

    if (!business.is_active || !business.manual_enabled) {
      return json({
        ok: false,
        error: "Bu işletmenin online sipariş sistemi aktif değildir.",
      }, 403);
    }

    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "Geçersiz sipariş isteği." }, 400);
    }

    const tenant = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (body.action === "cancel_pending_whatsapp_order") {
      const orderId = Number(body.order_id);
      const securityCode = String(body.security_code ?? "").trim();

      if (!Number.isSafeInteger(orderId) || orderId <= 0 || !securityCode) {
        return json({ ok: false, error: "Geçersiz iptal isteği." }, 400);
      }

      const { data: pendingOrder, error: pendingOrderError } = await tenant
        .from("orders")
        .select("id,business_id,status,verification_method,verified_at,whatsapp_code_hash")
        .eq("id", orderId)
        .eq("business_id", business.business_id)
        .maybeSingle();

      if (pendingOrderError) {
        console.error("Bekleyen sipariş iptal sorgu hatası:", pendingOrderError);
        return json({ ok: false, error: "Sipariş iptal edilemedi." }, 500);
      }

      if (!pendingOrder) {
        return json({ ok: true, cancelled: true, already_missing: true });
      }

      if (
        pendingOrder.status !== "onay-bekliyor" ||
        pendingOrder.verification_method !== "whatsapp-business" ||
        pendingOrder.verified_at
      ) {
        return json({ ok: false, error: "Bu sipariş artık iptal edilemez." }, 409);
      }

      const suppliedHash = await sha256Hex(securityCode);

      if (
        !pendingOrder.whatsapp_code_hash ||
        suppliedHash !== pendingOrder.whatsapp_code_hash
      ) {
        return json({ ok: false, error: "Sipariş iptal doğrulaması başarısız." }, 403);
      }

      const { error: deleteError } = await tenant
        .from("orders")
        .delete()
        .eq("id", orderId)
        .eq("business_id", business.business_id)
        .eq("status", "onay-bekliyor");

      if (deleteError) {
        console.error("Bekleyen WhatsApp siparişi silinemedi:", deleteError);
        return json({ ok: false, error: "Sipariş iptal edilemedi." }, 500);
      }

      return json({ ok: true, cancelled: true, order_id: orderId });
    }

    const items = Array.isArray(body.p_items) ? body.p_items : [];
    if (!items.length) {
      return json({ ok: false, error: "Siparişte ürün bulunmuyor." }, 400);
    }

    const rpcPayload = {
      p_business_id: business.business_id,
      p_name: String(body.p_name ?? ""),
      p_address: String(body.p_address ?? ""),
      p_payment: String(body.p_payment ?? ""),
      p_note: String(body.p_note ?? ""),
      p_latitude: body.p_latitude ?? null,
      p_longitude: body.p_longitude ?? null,
      p_google_maps_url: String(body.p_google_maps_url ?? ""),
      p_items: items,
      p_coupon_codes: Array.isArray(body.p_coupon_codes) ? body.p_coupon_codes : [],
    };

    const { data: orderResult, error: orderError } = await tenant.rpc(
      "create_pending_whatsapp_order_with_coupons",
      rpcPayload,
    );

    if (orderError) {
      console.error("Sipariş RPC hatası:", orderError);
      return json({
        ok: false,
        error: orderError.message || "Sipariş oluşturulamadı.",
      }, 400);
    }

    return json({
      ok: true,
      data: orderResult,
    });
  } catch (error) {
    console.error("create-licensed-order beklenmeyen hata:", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Beklenmeyen sunucu hatası.",
    }, 500);
  }
});
