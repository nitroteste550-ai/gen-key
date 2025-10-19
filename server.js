const express = require('express');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname)));

const db = new Database('webhooks.db');
db.exec(`
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_text TEXT UNIQUE NOT NULL,
  webhook_url TEXT NOT NULL,
  plots TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
`);

function rnd4(){ const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let out=''; for(let i=0;i<4;i++) out+=chars.charAt(Math.floor(Math.random()*chars.length)); return out;}
function makeKey(){ return `SOUZA-${rnd4()}`;}
function isoNow(){ return new Date().toISOString(); }
function isoPlusDays(days){ return new Date(Date.now() + days*24*60*60*1000).toISOString(); }
function isDiscordWebhook(url){
  try{
    const u=new URL(url);
    return (u.hostname.includes('discord')||u.hostname.includes('discordapp')) && /\/api\/webhooks\/\d+\/[A-Za-z0-9_\-\.]+/.test(u.pathname);
  }catch(e){ return false; }
}

app.post('/register', async(req,res)=>{
  const {webhook_url,plots}=req.body;
  if(!webhook_url || !Array.isArray(plots) || plots.length===0) return res.status(400).json({error:'webhook_url and plots[] required'});
  if(!isDiscordWebhook(webhook_url)) return res.status(400).json({error:'Invalid Discord webhook URL'});
  const now = isoNow(), expiresAt = isoPlusDays(40);
  const insert = db.prepare('INSERT INTO registrations (key_text,webhook_url,plots,created_at,expires_at) VALUES (?,?,?,?,?)');
  let key = makeKey();
  for(let i=0;i<8;i++){
    try{ insert.run(key,webhook_url,JSON.stringify(plots),now,expiresAt); return res.json({ok:true,key,expires_at:expiresAt}); }
    catch(err){ if(err.code==='SQLITE_CONSTRAINT_UNIQUE') key=makeKey(); else return res.status(500).json({error:'db_error'}); }
  }
  return res.status(500).json({error:'could_not_generate_unique_key'});
});

app.post('/notify',async(req,res)=>{
  const {plot_id,brainrot,extra}=req.body;
  if(!plot_id||!brainrot) return res.status(400).json({error:'plot_id and brainrot required'});
  const rows = db.prepare('SELECT id,key_text,webhook_url,plots,expires_at FROM registrations').all();
  const now = new Date();
  const targets = [];
  for(const r of rows){
    try{ const plots=JSON.parse(r.plots); if(plots.includes(plot_id) && (!r.expires_at||new Date(r.expires_at)>=now)) targets.push(r); }catch(e){}
  }
  if(targets.length===0) return res.json({ok:true,notified:0,msg:'no webhook registered for this plot'});
  const results=[];
  for(const t of targets){
    try{
      const payload={username:'StealBot',embeds:[{title:'Brainrot Detected!',description:`**${brainrot}** encontrado no plot \`${plot_id}\``,color:16753920,fields:[{name:'Key',value:t.key_text,inline:true},{name:'Plot',value:plot_id,inline:true},...(extra?[{name:'Info',value:JSON.stringify(extra).slice(0,1000)}]:[])] ,timestamp:new Date().toISOString()}]};
      const r2 = await fetch(t.webhook_url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      results.push({id:t.id,key:t.key_text,status:r2.status});
    }catch(err){ console.error(err); results.push({id:t.id,key:t.key_text,error:String(err)}); }
  }
  res.json({ok:true,notified:results.length,results});
});

const port = process.env.PORT || 3000;
app.listen(port,()=>console.log('server listening on',port));
