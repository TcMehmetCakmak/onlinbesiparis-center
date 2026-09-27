import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type":"application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:corsHeaders });
  if (req.method !== "POST") return json({ ok:false, error:"Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const platformControlUrl = Deno.env.get("PLATFORM_CONTROL_URL");
    const bridgeSecret = Deno.env.get("PLATFORM_BRIDGE_SECRET");

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !platformControlUrl || !bridgeSecret) {
      return json({ ok:false, error:"Sunucu yapılandırması eksik." }, 500);
    }

    const authorization = req.headers.get("Authorization") || "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ ok:false, error:"Oturum bulunamadı." }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      auth:{ persistSession:false, autoRefreshToken:false }
    });
    const { data:userData, error:userError } = await authClient.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return json({ ok:false, error:"Geçersiz veya süresi dolmuş oturum." }, 401);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth:{ persistSession:false, autoRefreshToken:false }
    });
    const { data:profile, error:profileError } = await db.from("profiles")
      .select("id,role,business_id")
      .eq("id", userData.user.id)
      .eq("role","admin")
      .maybeSingle();

    if (profileError) return json({ ok:false, error:"Admin profili doğrulanamadı." }, 500);
    if (!profile?.business_id) {
      return json({ ok:false, error:"Bu hesap bir işletme adminine bağlı değil." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const payload:any = {
      action,
      business_id:profile.business_id,
      admin_user_id:userData.user.id
    };

    if (action === "create") {
      payload.title = String(body?.title || "").trim();
      payload.detail = String(body?.detail || "").trim();
    } else if (action === "complete") {
      payload.ticket_id = Number(body?.ticket_id);
    } else if (action !== "list") {
      return json({ ok:false, error:"Geçersiz action." }, 400);
    }

    const response = await fetch(
      `${platformControlUrl.replace(/\/+$/,"")}/functions/v1/tenant-support-ticket`,
      {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "x-platform-bridge-secret":bridgeSecret
        },
        body:JSON.stringify(payload)
      }
    );

    const responseBody = await response.json().catch(() => ({
      ok:false,error:"Merkezi sunucu geçersiz cevap verdi."
    }));
    return json(responseBody, response.status);
  } catch (error) {
    console.error(error);
    return json({ ok:false, error:error instanceof Error ? error.message : "Beklenmeyen hata." }, 500);
  }
});
