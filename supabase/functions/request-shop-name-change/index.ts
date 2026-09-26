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
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  // Browser CORS preflight
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
      console.error("Missing tenant Supabase environment variables", {
        hasSupabaseUrl: !!supabaseUrl,
        hasAnonKey: !!supabaseAnonKey,
      });
      return json({ ok: false, error: "Tenant Supabase yapılandırması eksik." }, 500);
    }

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
      .select("id,role")
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

    if (!profile) {
      return json(
        { ok: false, error: "Bu kullanıcı işletme yöneticisi değil." },
        403,
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestedName = String(body?.requested_name ?? "").trim();

    if (!requestedName) {
      return json({ ok: false, error: "Yeni dükkan adı gerekli." }, 400);
    }

    if (requestedName.length > 80) {
      return json(
        { ok: false, error: "Dükkan adı en fazla 80 karakter olabilir." },
        400,
      );
    }

    const controlUrl = Deno.env.get("PLATFORM_CONTROL_URL");
    const controlPublishableKey = Deno.env.get(
      "PLATFORM_CONTROL_PUBLISHABLE_KEY",
    );
    const businessKey = Deno.env.get("PLATFORM_BUSINESS_KEY");
    const businessToken = Deno.env.get("PLATFORM_BUSINESS_TOKEN");

    const missingSecrets = [
      ["PLATFORM_CONTROL_URL", controlUrl],
      ["PLATFORM_CONTROL_PUBLISHABLE_KEY", controlPublishableKey],
      ["PLATFORM_BUSINESS_KEY", businessKey],
      ["PLATFORM_BUSINESS_TOKEN", businessToken],
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
      },
      body: JSON.stringify({
        business_key: businessKey,
        business_token: businessToken,
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
        businessKey,
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
