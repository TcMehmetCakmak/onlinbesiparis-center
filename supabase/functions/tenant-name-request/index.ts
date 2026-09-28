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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Oturum bilgisi bulunamadı." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing tenant Supabase environment variables.");
      return json(
        { ok: false, error: "Tenant Supabase yapılandırması eksik." },
        500,
      );
    }

    // Kullanıcının gerçek tenant kimliği URL'den veya browser'dan değil,
    // authenticated admin profilinden alınır.
    const tenant = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await tenant.auth.getUser();

    if (userError || !user) {
      console.error("Tenant user auth failed", userError);
      return json(
        {
          ok: false,
          error: "Oturum doğrulanamadı.",
          detail: userError?.message ?? null,
        },
        401,
      );
    }

    const { data: profile, error: profileError } = await tenant
      .from("profiles")
      .select("id,role,business_id")
      .eq("id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (profileError) {
      console.error("Admin profile query failed", profileError);
      return json(
        {
          ok: false,
          error: "Admin yetkisi kontrol edilemedi.",
          detail: profileError.message,
        },
        500,
      );
    }

    if (!profile?.business_id) {
      return json(
        { ok: false, error: "Bu kullanıcı bir işletme yöneticisine bağlı değil." },
        403,
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestedName = String(body?.requested_name ?? "").trim();

    if (!requestedName) {
      return json({ ok: false, error: "Yeni dükkan adı gerekli." }, 400);
    }

    if (requestedName.length < 2 || requestedName.length > 80) {
      return json(
        { ok: false, error: "Dükkan adı 2 ile 80 karakter arasında olmalı." },
        400,
      );
    }

    const controlUrl = Deno.env.get("PLATFORM_CONTROL_URL");
    const controlPublishableKey = Deno.env.get(
      "PLATFORM_CONTROL_PUBLISHABLE_KEY",
    );
    const bridgeSecret = Deno.env.get("PLATFORM_BRIDGE_SECRET");

    const missingSecrets = [
      ["PLATFORM_CONTROL_URL", controlUrl],
      ["PLATFORM_CONTROL_PUBLISHABLE_KEY", controlPublishableKey],
      ["PLATFORM_BRIDGE_SECRET", bridgeSecret],
    ].filter(([, value]) => !value).map(([name]) => name);

    if (missingSecrets.length) {
      console.error("Missing Edge Function secrets", missingSecrets);
      return json(
        {
          ok: false,
          error: "Platform bağlantı ayarları eksik.",
          missing: missingSecrets,
        },
        500,
      );
    }

    const endpoint =
      `${controlUrl!.replace(/\/+$/, "")}/functions/v1/tenant-name-request`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": controlPublishableKey!,
        "x-platform-bridge-secret": bridgeSecret!,
      },
      body: JSON.stringify({
        business_id: profile.business_id,
        requested_name: requestedName,
      }),
    });

    const raw = await response.text();
    let centralData: any = null;

    try {
      centralData = raw ? JSON.parse(raw) : {};
    } catch {
      centralData = { raw };
    }

    if (!response.ok || centralData?.ok === false) {
      console.error("Central tenant-name-request failed", {
        status: response.status,
        statusText: response.statusText,
        response: centralData,
        businessId: profile.business_id,
        requestedName,
      });

      return json(
        {
          ok: false,
          error:
            centralData?.error ??
            `Merkezi isim talebi servisi hata verdi (${response.status}).`,
          detail: centralData,
        },
        response.status || 500,
      );
    }

    return json({
      ok: true,
      business_id: profile.business_id,
      requested_name: requestedName,
      data: centralData,
    });
  } catch (error) {
    console.error("request-shop-name-change unexpected error", error);

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "İsim değişikliği talebi gönderilemedi.",
      },
      500,
    );
  }
});
