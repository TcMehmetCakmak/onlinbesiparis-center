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
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const PLATFORM_CONTROL_URL =
      Deno.env.get("PLATFORM_CONTROL_URL");
    const PLATFORM_NAME_BRIDGE_SECRET =
      Deno.env.get("PLATFORM_NAME_BRIDGE_SECRET");

    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !PLATFORM_CONTROL_URL ||
      !PLATFORM_NAME_BRIDGE_SECRET
    ) {
      console.error("request-shop-name-change: eksik secret");
      return json({
        ok: false,
        error: "Sunucu yapılandırması eksik.",
      }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";

    if (!authHeader.startsWith("Bearer ")) {
      return json({
        ok: false,
        error: "Oturum doğrulanamadı.",
      }, 401);
    }

    const accessToken = authHeader.substring(7).trim();

    const authClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const { data: userData, error: userError } =
      await authClient.auth.getUser(accessToken);

    if (userError || !userData?.user) {
      console.error("Admin JWT doğrulama hatası:", userError);
      return json({
        ok: false,
        error: "Oturum geçersiz veya süresi dolmuş.",
      }, 401);
    }

    const tenantAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const { data: profile, error: profileError } =
      await tenantAdmin
        .from("profiles")
        .select("id,role,business_id")
        .eq("id", userData.user.id)
        .maybeSingle();

    if (profileError) {
      console.error("Profil sorgu hatası:", profileError);
      return json({
        ok: false,
        error: "Admin profili doğrulanamadı.",
      }, 500);
    }

    if (
      !profile ||
      profile.role !== "admin" ||
      !profile.business_id
    ) {
      return json({
        ok: false,
        error: "Bu işlem için işletme yöneticisi yetkisi gerekli.",
      }, 403);
    }

    const body = await req.json().catch(() => null);
    const requestedName =
      String(body?.requested_name ?? "").trim();

    if (
      requestedName.length < 2 ||
      requestedName.length > 80
    ) {
      return json({
        ok: false,
        error: "Dükkan adı 2 ile 80 karakter arasında olmalı.",
      }, 400);
    }

    const endpoint =
      PLATFORM_CONTROL_URL.replace(/\/$/, "") +
      "/functions/v1/tenant-name-request";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-platform-name-bridge-secret":
          PLATFORM_NAME_BRIDGE_SECRET,
      },
      body: JSON.stringify({
        business_id: profile.business_id,
        requested_name: requestedName,
      }),
    });

    const centralBody =
      await response.json().catch(() => null);

    if (!response.ok || !centralBody?.ok) {
      console.error("Central tenant-name-request failed", {
        status: response.status,
        statusText: response.statusText,
        response: centralBody,
        businessId: profile.business_id,
        requestedName,
      });

      return json({
        ok: false,
        error:
          centralBody?.error ||
          `Merkezi isim servisi hata verdi (${response.status}).`,
      }, response.status || 502);
    }

    return json({
      ok: true,
      request: centralBody.request,
    });
  } catch (error) {
    console.error(
      "request-shop-name-change unexpected error:",
      error,
    );

    return json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Beklenmeyen sunucu hatası.",
    }, 500);
  }
});
