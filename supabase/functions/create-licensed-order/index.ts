import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const PLATFORM_CONTROL_URL = Deno.env.get("PLATFORM_CONTROL_URL");
    const PLATFORM_CONTROL_PUBLISHABLE_KEY = Deno.env.get(
      "PLATFORM_CONTROL_PUBLISHABLE_KEY",
    );
    const PLATFORM_BUSINESS_KEY = Deno.env.get("PLATFORM_BUSINESS_KEY");

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !PLATFORM_CONTROL_URL ||
      !PLATFORM_CONTROL_PUBLISHABLE_KEY ||
      !PLATFORM_BUSINESS_KEY
    ) {
      console.error("Eksik Edge Function environment/secrets.");
      return json(
        {
          ok: false,
          error:
            "Sunucu yapılandırması eksik. Edge Function secret ayarlarını kontrol edin.",
        },
        500,
      );
    }

    // Merkezi projeden işletmenin güncel lisans/aktiflik bilgisini al.
    const platform = createClient(
      PLATFORM_CONTROL_URL,
      PLATFORM_CONTROL_PUBLISHABLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );

    const { data: business, error: businessError } = await platform
      .from("business_public")
      .select(
        "business_id,public_key,shop_name,slug,license_end_date,manual_enabled,is_active",
      )
      .eq("public_key", PLATFORM_BUSINESS_KEY)
      .maybeSingle();

    if (businessError) {
      console.error("Merkezi işletme sorgu hatası:", businessError);
      return json(
        { ok: false, error: "İşletme lisans bilgisi kontrol edilemedi." },
        502,
      );
    }

    if (!business) {
      return json(
        { ok: false, error: "Merkezi işletme kaydı bulunamadı." },
        404,
      );
    }

    if (!business.is_active || !business.manual_enabled) {
      return json(
        {
          ok: false,
          error: "Bu işletmenin online sipariş sistemi aktif değildir.",
        },
        403,
      );
    }

    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "Geçersiz sipariş isteği." }, 400);
    }

    const items = Array.isArray(body.p_items) ? body.p_items : [];
    if (!items.length) {
      return json({ ok: false, error: "Siparişte ürün bulunmuyor." }, 400);
    }

    // Tenant/ortak veri DB'sinde service_role ile mevcut güvenli sipariş RPC'sini çağır.
    const tenant = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const rpcPayload = {
      p_name: String(body.p_name ?? ""),
      p_address: String(body.p_address ?? ""),
      p_payment: String(body.p_payment ?? ""),
      p_note: String(body.p_note ?? ""),
      p_latitude: body.p_latitude ?? null,
      p_longitude: body.p_longitude ?? null,
      p_google_maps_url: String(body.p_google_maps_url ?? ""),
      p_items: items,
      p_coupon_codes: Array.isArray(body.p_coupon_codes)
        ? body.p_coupon_codes
        : [],
    };

    const { data: orderResult, error: orderError } = await tenant.rpc(
      "create_pending_whatsapp_order_with_coupons",
      rpcPayload,
    );

    if (orderError) {
      console.error("Sipariş RPC hatası:", orderError);
      return json(
        {
          ok: false,
          error: orderError.message || "Sipariş oluşturulamadı.",
        },
        400,
      );
    }

    const orderId = orderResult?.id;

    if (!orderId) {
      console.error("RPC sipariş id döndürmedi:", orderResult);
      return json(
        { ok: false, error: "Sipariş oluşturuldu ancak sipariş ID alınamadı." },
        500,
      );
    }

    // Multi-tenant geçişi: siparişi merkezi işletme UUID'sine bağla.
    const { error: businessIdUpdateError } = await tenant
      .from("orders")
      .update({ business_id: business.business_id })
      .eq("id", orderId);

    if (businessIdUpdateError) {
      console.error(
        "Sipariş business_id güncelleme hatası:",
        businessIdUpdateError,
      );

      // Yanlış tenant bilgili yarım sipariş bırakmamak için temizle.
      await tenant.from("orders").delete().eq("id", orderId);

      return json(
        {
          ok: false,
          error:
            "Sipariş işletmeye bağlanamadı. Sipariş kaydı güvenlik nedeniyle iptal edildi.",
        },
        500,
      );
    }

    return json({
      ok: true,
      data: {
        ...orderResult,
        business_id: business.business_id,
      },
    });
  } catch (error) {
    console.error("create-licensed-order beklenmeyen hata:", error);
    return json(
      {
        ok: false,
        error: error instanceof Error
          ? error.message
          : "Beklenmeyen sunucu hatası.",
      },
      500,
    );
  }
});
