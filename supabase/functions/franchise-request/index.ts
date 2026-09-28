import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return new Response("Method not allowed",{status:405,headers:cors});
 try{
  const body=await req.json();
  const customer_name=String(body.customer_name||"").trim();
  const phone=String(body.phone||"").trim();
  const email=body.email?String(body.email).trim():null;
  const note=body.note?String(body.note).trim():null;
  const slug=body.business_slug?String(body.business_slug).trim().toLowerCase():null;
  if(customer_name.length<2||customer_name.length>120)throw new Error("Geçersiz ad soyad");
  if(phone.replace(/\D/g,"").length<10||phone.length>30)throw new Error("Geçersiz telefon");
  if(email&&email.length>160)throw new Error("Geçersiz e-posta");
  if(note&&note.length>1500)throw new Error("Not çok uzun");
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  let business_id=null,business_name=null;
  if(slug){const {data}=await db.from("businesses").select("id,shop_name,slug").eq("slug",slug).maybeSingle();if(data){business_id=data.id;business_name=data.shop_name;}}
  const cutoff=new Date(Date.now()-5*60*1000).toISOString();
  const {data:dupe}=await db.from("franchise_requests").select("id").eq("phone",phone).gte("created_at",cutoff).limit(1);
  if(dupe?.length)throw new Error("Bu telefon numarasıyla kısa süre önce bir talep gönderildi.");
  const {error}=await db.from("franchise_requests").insert({business_id,business_slug:slug,business_name,customer_name,phone,email,note,status:"pending"});
  if(error)throw error;
  return new Response(JSON.stringify({ok:true}),{headers:{...cors,"Content-Type":"application/json"}});
 }catch(e){return new Response(JSON.stringify({error:e?.message||"Talep gönderilemedi"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});}
});
