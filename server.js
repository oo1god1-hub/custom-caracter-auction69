const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { Server } = require('socket.io');
const cloudinary = require('cloudinary').v2;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const GAME_PASSWORD = process.env.GAME_PASSWORD || '';
const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const ROSTER_FILE = path.join(DATA_DIR, 'roster.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const ROSTER_BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(ROSTER_BACKUP_DIR, { recursive: true });
const LEGACY_ROSTER_FILE = path.join(__dirname, 'data', 'roster.json');
// One-time migration: copy the old local roster only when the persistent target is empty.
if (!fs.existsSync(ROSTER_FILE) && path.resolve(LEGACY_ROSTER_FILE) !== path.resolve(ROSTER_FILE) && fs.existsSync(LEGACY_ROSTER_FILE)) {
  fs.copyFileSync(LEGACY_ROSTER_FILE, ROSTER_FILE);
  console.log('Migrated legacy roster to DATA_DIR.');
}
const publicDir = path.join(__dirname, 'public');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});
const cloudReady = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

const defaultCharacters = [
  {id:'sheetal',name:'Sheetal',tier:'SSS',power:100,price:1000,rarity:'Ultimate Legendary',ability:'Ability to be configured',description:'Top-ranked character.'},
  {id:'mannat',name:'Mannat',tier:'A',power:74,price:300,rarity:'Rare',ability:'Ability to be configured',description:'Legendary character.'},
  {id:'namrata',name:'Namrata',tier:'S',power:84,price:500,rarity:'Epic',ability:'Ability to be configured',description:'Rare character.'},
  {id:'riya',name:'Riya',tier:'SSS',power:100,price:1000,rarity:'Ultimate Legendary',ability:'Ability to be configured',description:'Second-highest power.'},
  {id:'vibha',name:'Vibha',tier:'SS',power:92,price:800,rarity:'Legendary',ability:'Ability to be configured',description:'Rare character.'},
  {id:'wacha',name:'Wacha',tier:'SS',power:91,price:800,rarity:'Legendary',ability:'Ability to be configured',description:'Uncommon character.'},
  {id:'raanu',name:'Raanu',tier:'B',power:64,price:100,rarity:'Uncommon',ability:'Ability to be configured',description:'Legendary character.'},
  {id:'trisha',name:'Trisha',tier:'SS',power:94,price:800,rarity:'Legendary',ability:'Ability to be configured',description:'Legendary character.'},
  {id:'himani',name:'Himani',tier:'B',power:63,price:100,rarity:'Uncommon',ability:'Ability to be configured',description:'Epic character.'},
  {id:'sikha',name:'Sikha',tier:'B',power:60,price:100,rarity:'Uncommon',ability:'Ability to be configured',description:'Rare character.'},
  {id:'chanchal',name:'Chanchal',tier:'SSS',power:100,price:1000,rarity:'Ultimate Legendary',ability:'Ability to be configured',description:'Third-highest power.'},
  {id:'kashish',name:'Kashish',tier:'SS',power:93,price:800,rarity:'Legendary',ability:'Ability to be configured',description:'Legendary character.'},
  {id:'manvi',name:'Manvi',tier:'A',power:72,price:300,rarity:'Rare',ability:'Ability to be configured',description:'Epic character.'},
  {id:'rasmi',name:'Rasmi',tier:'S',power:80,price:500,rarity:'Epic',ability:'Ability to be configured',description:'Uncommon character.'},
  {id:'archana',name:'Archana',tier:'B',power:62,price:100,rarity:'Uncommon',ability:'Ability to be configured',description:'Epic character.'},
  {id:'neha',name:'Neha',tier:'A',power:70,price:300,rarity:'Rare',ability:'Ability to be configured',description:'New default character.'}
];
function readRoster(){
  if (!fs.existsSync(ROSTER_FILE)) return defaultCharacters.map(c=>({...c,isDefault:true,enabled:true,imageUrl:null}));
  let saved;
  try { saved=JSON.parse(fs.readFileSync(ROSTER_FILE,'utf8')); }
  catch (e) { throw new Error(`Saved roster at ${ROSTER_FILE} is invalid; refusing to overwrite it. Back up and repair the file. ${e.message}`); }
  if (!Array.isArray(saved)) throw new Error(`Saved roster at ${ROSTER_FILE} must contain a JSON array.`);
  const savedById=new Map(saved.map(c=>[c.id,c]));
  // Defaults are authoritative for names, tiers, prices and rebalanced power. Preserve only user-managed metadata (not stale gameplay defaults) from the saved copy.
  const defaults=defaultCharacters.map(c=>{const old=savedById.get(c.id)||{};return {...old,...c,imageUrl:old.imageUrl??null,cloudPublicId:old.cloudPublicId,imageVersion:old.imageVersion,isDefault:true,enabled:true};});
  const extras=saved.filter(c=>!defaultCharacters.some(d=>d.id===c.id)).map(c=>({...c,isDefault:false,enabled:c.enabled!==false}));
  return [...defaults,...extras];
}
let roster=readRoster();
function saveRoster(){
  if(fs.existsSync(ROSTER_FILE)){
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    fs.copyFileSync(ROSTER_FILE,path.join(ROSTER_BACKUP_DIR,`roster-${stamp}.json`));
  }
  const tmp=ROSTER_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(roster,null,2),{mode:0o600});
  fs.renameSync(tmp,ROSTER_FILE);
}
const sessions=new Map();
function newToken(){return crypto.randomBytes(32).toString('hex');}
function authGame(req,res,next){const token=req.get('x-game-token');if(!token||!sessions.has(token)||sessions.get(token).admin)return res.status(401).json({error:'Please unlock the game again.'});req.gameToken=token;next();}
const loginAttempts=new Map();
function allowLogin(req,res,next){const key=(req.ip||'unknown')+':'+req.path;const now=Date.now();const recent=(loginAttempts.get(key)||[]).filter(t=>now-t<10*60*1000);if(recent.length>=10)return res.status(429).json({error:'Too many attempts. Try again in 10 minutes.'});recent.push(now);loginAttempts.set(key,recent);next();}
function authAdmin(req,res,next){const token=req.get('x-admin-token');const session=token&&sessions.get(token);if(!session?.admin)return res.status(401).json({error:'Admin login required.'});next();}
app.post('/api/auth/game',allowLogin,(req,res)=>{
  if(!GAME_PASSWORD)return res.status(503).json({error:'Set GAME_PASSWORD in the hosting environment first.'});
  if(String(req.body?.password||'')!==GAME_PASSWORD)return res.status(401).json({error:'Incorrect game password.'});
  const token=newToken();sessions.set(token,{admin:false,createdAt:Date.now()});res.json({ok:true,token});
});
app.post('/api/auth/admin',allowLogin,(req,res)=>{
  if(!ADMIN_PASSWORD)return res.status(503).json({error:'Set ADMIN_PASSWORD in Render Environment Variables first.'});
  if(String(req.body?.password||'')!==ADMIN_PASSWORD)return res.status(401).json({error:'Incorrect admin password.'});
  const token=newToken();sessions.set(token,{admin:true,createdAt:Date.now()});res.json({ok:true,token});
});
app.get('/api/admin/roster',authAdmin,(_req,res)=>res.json({characters:roster,cloudReady}));
app.patch('/api/admin/characters/:id/enabled',authAdmin,(req,res)=>{
  const c=roster.find(x=>x.id===req.params.id);
  if(!c)return res.status(404).json({error:'Character not found.'});
  if(c.isDefault)return res.status(403).json({error:'Default characters are protected in normal multiplayer.'});
  c.enabled=req.body?.enabled===true; saveRoster(); res.json({ok:true,enabled:c.enabled});
});
const imageUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_IMAGE_UPLOAD_BYTES},fileFilter:(_req,file,cb)=>['image/png','image/jpeg','image/webp','image/gif'].includes(file.mimetype)?cb(null,true):cb(new Error('Upload PNG, JPG, WEBP or GIF.'))});
async function uploadCloudImage(file,id){
  if(!cloudReady)throw new Error('Cloudinary is not configured. Add its three environment variables in Render.');
  return new Promise((resolve,reject)=>{
    const stream=cloudinary.uploader.upload_stream({folder:'character-auction',public_id:id,overwrite:true,resource_type:'image',type:'authenticated',allowed_formats:['jpg','jpeg','png','webp','gif']},(err,result)=>err?reject(err):resolve(result));
    stream.end(file.buffer);
  });
}
app.post('/api/admin/characters/:id/image',authAdmin,(req,res)=>imageUpload.single('image')(req,res,async err=>{
  if(err)return res.status(400).json({error:err.message});
  try{
    const c=roster.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:'Character not found.'});
    if(!req.file)return res.status(400).json({error:'Choose an image to upload.'});
    const result=await uploadCloudImage(req.file,c.id);
    c.imageUrl=result.secure_url;c.cloudPublicId=result.public_id;c.imageVersion=result.version;saveRoster();res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message||'Cloudinary upload failed.'});}
}));
app.post('/api/admin/characters',authAdmin,(req,res)=>{
  const name=String(req.body?.name||'').trim().slice(0,32),tier=String(req.body?.tier||'').toUpperCase(),price=Number(req.body?.price),power=Number(req.body?.power??50);
  if(!name||!['SSS','SS','S','A','B'].includes(tier)||!Number.isSafeInteger(price)||price<1||!Number.isFinite(power)||power<0||power>100)return res.status(400).json({error:'Enter a name, valid tier, positive whole-number price and power from 0 to 100.'});
  const id='custom-'+crypto.randomBytes(6).toString('hex');const c={id,name,tier,power:Math.round(power),price,rarity:tier+' Tier',ability:'Ability to be configured',description:'Custom character added by admin.',imageUrl:null,isDefault:false,enabled:true};roster.push(c);saveRoster();res.json({ok:true,character:c});
});
app.delete('/api/admin/characters/:id',authAdmin,async(req,res)=>{
  const index=roster.findIndex(c=>c.id===req.params.id);if(index<0)return res.status(404).json({error:'Character not found.'});
  if(roster[index].isDefault||defaultCharacters.some(c=>c.id===req.params.id))return res.status(403).json({error:'Default characters cannot be removed.'});
  const [removed]=roster.splice(index,1);saveRoster();
  if(cloudReady&&removed.cloudPublicId){try{await cloudinary.uploader.destroy(removed.cloudPublicId,{type:'authenticated',resource_type:'image'});}catch{}}
  res.json({ok:true});
});
app.get('/api/character-image/:id',authGame,async(req,res)=>{
  const c=roster.find(x=>x.id===req.params.id);if(!c?.cloudPublicId||!cloudReady)return res.status(404).end();
  try{const signed=cloudinary.url(c.cloudPublicId,{secure:true,type:'authenticated',sign_url:true,version:c.imageVersion,expires_at:Math.floor(Date.now()/1000)+300});res.redirect(302,signed);}catch{res.status(404).end();}
});

const STARTING_BUDGET=15000;const rooms=new Map();
function persistRooms(){
  const data=[...rooms.values()].map(r=>({...r,timer:undefined,transitionTimer:undefined,botTimer:undefined,soldIds:[...r.soldIds]}));
  const tmp=ROOMS_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,ROOMS_FILE);
}
function restoreRooms(){
  if(!fs.existsSync(ROOMS_FILE))return;
  let saved;try{saved=JSON.parse(fs.readFileSync(ROOMS_FILE,'utf8'));}catch(e){console.error('Room state file is invalid; not overwriting it:',e.message);return;}
  if(!Array.isArray(saved))return;
  for(const raw of saved){if(!raw||!raw.code||!Array.isArray(raw.players))continue;const r={...raw,timer:null,transitionTimer:null,soldIds:new Set(raw.soldIds||[])};for(const p of r.players)p.connected=false;rooms.set(r.code,r);}
}
const cloneCharacters=()=>roster.filter(c=>c.isDefault||c.enabled!==false).map(c=>({...c}));
function makeCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code;do{code=Array.from({length:6},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');}while(rooms.has(code));return code;}
function totalPower(p){return p.characters.reduce((s,c)=>s+c.power,0);}
function imageFor(c){if(c?.cloudPublicId&&cloudReady){try{return cloudinary.url(c.cloudPublicId,{secure:true,type:'authenticated',sign_url:true,version:c.imageVersion});}catch{}}return c?.imageUrl||null;}
function publicRoom(room){
  // In Surprise Mode, reveal only characters already presented in the auction.
  // Never send the upcoming selected character list to clients ahead of time.
  const visibleCharacters=room.surpriseMode
    ? room.characters.slice(0, room.status==='waiting' ? 0 : Math.min(room.auctionIndex+(room.currentAuction?1:0),room.characters.length))
    : room.characters;
  return {code:room.code,status:room.status,paused:room.paused,surpriseMode:!!room.surpriseMode,botMode:!!room.botMode,remainingMs:room.paused?room.remainingMs:null,hostId:room.hostId,players:room.players.map(p=>({id:p.id,name:p.name,isBot:!!p.isBot,connected:p.connected!==false,budget:p.budget,characters:p.characters.map(c=>({id:c.id,name:c.name,tier:c.tier,power:c.power,pricePaid:c.pricePaid,imageUrl:imageFor(c)})),...(room.status==='finished'?{totalPower:totalPower(p)}:{})})),characters:visibleCharacters.map(c=>{const {cloudPublicId,imageVersion,...safe}=c;return {...safe,imageUrl:imageFor(c)};}),auctionCharacterCount:room.characters.length,auctionIndex:room.auctionIndex,currentAuction:room.currentAuction,history:room.status==='finished'?room.history:[],winnerId:room.winnerId||null};
}
function emitRoom(room){persistRooms();io.to(room.code).emit('room:update',publicRoom(room));}
function playerById(room,id){return room.players.find(p=>p.id===id);}
function stopTimer(room){if(room.timer){clearTimeout(room.timer);room.timer=null;}if(room.transitionTimer){clearTimeout(room.transitionTimer);room.transitionTimer=null;}if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}}
function scheduleTimer(room){stopTimer(room);if(room.paused||!room.currentAuction)return;const expected=room.currentAuction.characterId;room.timer=setTimeout(()=>{const latest=rooms.get(room.code);if(latest&&latest.status==='auction'&&!latest.paused&&latest.currentAuction?.characterId===expected)closeAuction(latest);},Math.max(0,room.currentAuction.endsAt-Date.now()));}
function closeAuction(room){if(!room.currentAuction||room.paused)return;if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}const a=room.currentAuction;const character=room.characters.find(c=>c.id===a.characterId);if(a.highestBidderId){const winner=playerById(room,a.highestBidderId);if(winner&&character&&!room.soldIds.has(character.id)){winner.budget-=a.highestBid;winner.characters.push({...character,pricePaid:a.highestBid});room.soldIds.add(character.id);room.history.push({characterId:character.id,characterName:character.name,winnerId:winner.id,winnerName:winner.name,price:a.highestBid,result:'SOLD'});}}else room.history.push({characterId:character?.id,characterName:character?.name,winnerId:null,winnerName:null,price:0,result:'UNSOLD'});room.currentAuction=null;room.auctionIndex++;emitRoom(room);if(room.transitionTimer)clearTimeout(room.transitionTimer);room.transitionTimer=setTimeout(()=>{room.transitionTimer=null;advanceAuction(room.code);},1200);}
function botBidDecision(room,bot){
  const a=room.currentAuction;if(!a||room.paused||room.status!=='auction')return null;
  const c=room.characters.find(x=>x.id===a.characterId);if(!c)return null;
  const current=a.highestBid;const increment=Math.max(50,Math.ceil(current*0.08/50)*50);
  const teamPower=totalPower(bot);const averagePower=bot.characters.length?teamPower/bot.characters.length:0;
  const tierFactor={SSS:1,SS:.82,S:.68,A:.52,B:.35}[c.tier]||.4;
  const needFactor=bot.characters.length<2?1.15:bot.characters.length<5?1:0.82;
  const cap=Math.min(bot.budget,Math.floor((c.price*(1.2+tierFactor*1.5)*needFactor)/50)*50);
  if(current>=cap||current+increment>bot.budget)return null;
  // Distinct personalities: aggressive bids more often; cautious protects budget; opportunist values high power.
  const personality=bot.personality||'balanced';
  const chance=personality==='aggressive'?.82:personality==='cautious'?.38:.62;
  const valueScore=(c.power/100)*tierFactor+(averagePower<70?.15:0);
  if(valueScore<.48||Math.random()>chance)return null;
  return current+increment;
}
function scheduleBotBids(room){
  if(!room.botMode||room.status!=='auction'||room.paused||!room.currentAuction)return;
  if(room.botTimer)clearTimeout(room.botTimer);
  const characterId=room.currentAuction.characterId;
  room.botTimer=setTimeout(()=>{
    const live=rooms.get(room.code);if(!live||live.paused||live.currentAuction?.characterId!==characterId)return;
    const bots=live.players.filter(p=>p.isBot).sort(()=>Math.random()-.5);
    for(const bot of bots){const bid=botBidDecision(live,bot);if(bid){live.currentAuction.highestBid=bid;live.currentAuction.highestBidderId=bot.id;live.currentAuction.endsAt=Date.now()+5000; scheduleTimer(live);emitRoom(live);break;}}
    live.botTimer=null;
  },1200+Math.floor(Math.random()*900));
}
function advanceAuction(code){const room=rooms.get(code);if(!room||room.status!=='auction'||room.currentAuction||room.paused)return;if(room.auctionIndex>=room.characters.length){room.status='finished';const ranked=[...room.players].sort((a,b)=>totalPower(b)-totalPower(a));const top=ranked[0]?totalPower(ranked[0]):0;const tied=ranked.filter(p=>totalPower(p)===top);room.winnerId=tied.length>1?'tie':ranked[0]?.id;emitRoom(room);return;}const c=room.characters[room.auctionIndex];room.currentAuction={characterId:c.id,startingPrice:c.price,highestBid:c.price,highestBidderId:null,endsAt:Date.now()+20000};scheduleTimer(room);emitRoom(room);scheduleBotBids(room);}

io.use((socket,next)=>{const auth=socket.handshake.auth||{};const adminToken=auth.adminToken;const gameToken=auth.gameToken;if(adminToken&&sessions.get(adminToken)?.admin){socket.data.admin=true;socket.data.adminToken=adminToken;return next();}if(!gameToken||!sessions.has(gameToken)||sessions.get(gameToken).admin)return next(new Error('Game password required.'));socket.data.gameToken=gameToken;socket.data.admin=false;next();});
io.on('connection',socket=>{
 socket.on('room:reconnect',({code,reconnectToken},cb)=>{const r=rooms.get(String(code||'').toUpperCase());if(socket.data.admin&&!r?.adminOnly)return cb?.({ok:false,error:'Use the admin auction controls.'});if(!socket.data.admin&&r?.adminOnly)return cb?.({ok:false,error:'Admin authentication required.'});const p=r?.players.find(x=>x.reconnectToken===reconnectToken);if(!r||!p)return cb?.({ok:false,error:'Reconnect session not found.'});const oldId=p.id;p.id=socket.id;p.connected=true;if(r.currentAuction?.highestBidderId===oldId)r.currentAuction.highestBidderId=socket.id;if(r.hostId===oldId)r.hostId=socket.id;socket.join(r.code);cb?.({ok:true,code:r.code});emitRoom(r);if(r.status==='auction'&&!r.paused&&r.currentAuction)scheduleTimer(r);});
 socket.on('admin:singleplayer',({name,characterIds},cb)=>{
  if(!socket.data.admin||!sessions.get(socket.data.adminToken)?.admin)return cb?.({ok:false,error:'Admin authentication required.'});
  const n=String(name||'Admin').trim().slice(0,20)||'Admin';
  const ids=Array.isArray(characterIds)?[...new Set(characterIds.map(String))]:[];
  const chosen=roster.filter(c=>ids.includes(c.id)).map(c=>({...c}));
  if(!chosen.length)return cb?.({ok:false,error:'Select at least one character.'});
  const code=makeCode();const human={id:socket.id,reconnectToken:newToken(),connected:true,name:n,budget:STARTING_BUDGET,characters:[]};
  const bots=[{id:'bot-'+newToken().slice(0,8),name:'Aarav (Aggressive)',personality:'aggressive',isBot:true,budget:STARTING_BUDGET,characters:[]},{id:'bot-'+newToken().slice(0,8),name:'Mira (Strategic)',personality:'cautious',isBot:true,budget:STARTING_BUDGET,characters:[]}];
  const room={code,hostId:socket.id,players:[human,...bots],status:'auction',paused:false,surpriseMode:false,botMode:true,adminOnly:true,characters:chosen.sort(()=>Math.random()-.5),auctionIndex:0,currentAuction:null,history:[],soldIds:new Set(),winnerId:null,timer:null,transitionTimer:null};rooms.set(code,room);socket.join(code);cb?.({ok:true,code,reconnectToken:human.reconnectToken});advanceAuction(code);
 });
 socket.on('room:singleplayer',({name},cb)=>{if(socket.data.admin)return cb?.({ok:false,error:'Use the admin auction controls.'});
  const n=String(name||'').trim().slice(0,20);if(!n)return cb?.({ok:false,error:'Enter your player name.'});
  const code=makeCode();const human={id:socket.id,reconnectToken:newToken(),connected:true,name:n,budget:STARTING_BUDGET,characters:[]};
  const bots=[{id:'bot-'+newToken().slice(0,8),name:'Aarav (Aggressive)',personality:'aggressive',isBot:true,budget:STARTING_BUDGET,characters:[]},{id:'bot-'+newToken().slice(0,8),name:'Mira (Strategic)',personality:'cautious',isBot:true,budget:STARTING_BUDGET,characters:[]}];
  const chars=cloneCharacters().sort(()=>Math.random()-.5);const room={code,hostId:socket.id,players:[human,...bots],status:'auction',paused:false,surpriseMode:false,botMode:true,characters:chars,auctionIndex:0,currentAuction:null,history:[],soldIds:new Set(),winnerId:null,timer:null,transitionTimer:null};rooms.set(code,room);socket.join(code);cb?.({ok:true,code,reconnectToken:human.reconnectToken});advanceAuction(code);
 });
 socket.on('room:create',({name},cb)=>{if(socket.data.admin)return cb?.({ok:false,error:'Admin-only connection.'});const n=String(name||'').trim().slice(0,20);if(!n)return cb?.({ok:false,error:'Enter your player name.'});const code=makeCode();const player={id:socket.id,reconnectToken:newToken(),connected:true,name:n,budget:STARTING_BUDGET,characters:[]};const room={code,hostId:socket.id,players:[player],status:'waiting',paused:false,surpriseMode:false,characters:cloneCharacters(),auctionIndex:0,currentAuction:null,history:[],soldIds:new Set(),winnerId:null,timer:null};rooms.set(code,room);socket.join(code);cb?.({ok:true,code,reconnectToken:player.reconnectToken});emitRoom(room);});
 socket.on('room:join',({code,name},cb)=>{if(socket.data.admin)return cb?.({ok:false,error:'Admin-only connection.'});const r=rooms.get(String(code||'').trim().toUpperCase()),n=String(name||'').trim().slice(0,20);if(!n)return cb?.({ok:false,error:'Enter your player name.'});if(!r)return cb?.({ok:false,error:'Room code not found.'});if(r.status!=='waiting')return cb?.({ok:false,error:'This auction has already started.'});if(r.players.length>=3)return cb?.({ok:false,error:'This room is full (maximum 3 players).'});if(r.players.some(p=>p.name.toLowerCase()===n.toLowerCase()))return cb?.({ok:false,error:'That player name is already being used in this room.'});const p={id:socket.id,reconnectToken:newToken(),connected:true,name:n,budget:STARTING_BUDGET,characters:[]};r.players.push(p);socket.join(r.code);cb?.({ok:true,code:r.code,reconnectToken:p.reconnectToken});emitRoom(r);});
 socket.on('room:surprise-mode',({enabled},cb)=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r)return cb?.({ok:false,error:'You are not in a room.'});if(r.hostId!==socket.id)return cb?.({ok:false,error:'Only the host can change game mode.'});if(r.status!=='waiting')return cb?.({ok:false,error:'Game mode can only be changed before the auction starts.'});r.surpriseMode=!!enabled;emitRoom(r);cb?.({ok:true});});
 socket.on('auction:start',cb=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r)return cb?.({ok:false,error:'You are not in a room.'});if(r.hostId!==socket.id)return cb?.({ok:false,error:'Only the host can start.'});if(r.status!=='waiting'||r.players.length<2)return cb?.({ok:false,error:'At least 2 players are required.'});{const shuffled=[...r.characters];for(let i=shuffled.length-1;i>0;i--){const j=crypto.randomInt(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}if(r.surpriseMode&&shuffled.length<8)return cb?.({ok:false,error:'Surprise Mode requires at least 8 enabled characters.'});r.characters=r.surpriseMode?shuffled.slice(0,8):shuffled;}r.status='auction';r.auctionIndex=0;emitRoom(r);advanceAuction(r.code);cb?.({ok:true});});
 socket.on('bid:place',({amount},cb)=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r||r.status!=='auction'||r.paused||!r.currentAuction)return cb?.({ok:false,error:'There is no active auction.'});const p=playerById(r,socket.id),bid=Number(amount),a=r.currentAuction;if(!Number.isSafeInteger(bid)||bid<=a.highestBid)return cb?.({ok:false,error:`Bid must be higher than ${a.highestBid.toLocaleString('en-IN')}.`});if(bid>p.budget)return cb?.({ok:false,error:'Your bid is higher than your remaining budget.'});const c=r.characters.find(x=>x.id===a.characterId);if(!c||r.soldIds.has(c.id))return cb?.({ok:false,error:'Character is no longer available.'});a.highestBid=bid;a.highestBidderId=p.id;a.endsAt=Date.now()+5000;scheduleTimer(r);emitRoom(r);scheduleBotBids(r);cb?.({ok:true});});
 socket.on('auction:pause',cb=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r||r.hostId!==socket.id)return cb?.({ok:false,error:'Only the host can pause.'});if(r.status!=='auction'||r.paused||!r.currentAuction)return cb?.({ok:false,error:'Auction cannot be paused during the character transition.'});r.remainingMs=Math.max(0,r.currentAuction.endsAt-Date.now());r.paused=true;stopTimer(r);emitRoom(r);cb?.({ok:true});});
 socket.on('auction:resume',cb=>{const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===socket.id));if(!r||r.hostId!==socket.id)return cb?.({ok:false,error:'Only the host can resume.'});if(r.status!=='auction'||!r.paused||!r.currentAuction)return cb?.({ok:false,error:'Auction is not paused on an active character.'});r.paused=false;r.currentAuction.endsAt=Date.now()+(r.remainingMs||0);scheduleTimer(r);emitRoom(r);scheduleBotBids(r);cb?.({ok:true});});
 socket.on('room:leave',()=>removePlayer(socket,true));socket.on('disconnect',()=>removePlayer(socket,false));
});
function removePlayer(socket,explicit=false){
  for(const [code,r] of rooms.entries()){
    const i=r.players.findIndex(p=>p.id===socket.id);if(i<0)continue;
    if(r.status==='waiting'&&explicit){r.players.splice(i,1);if(!r.players.length)rooms.delete(code);else{if(r.hostId===socket.id)r.hostId=r.players.find(p=>!p.isBot)?.id||r.players[0].id;emitRoom(r);}}
    else{r.players[i].connected=false;if(explicit&&r.hostId===socket.id){const next=r.players.find(p=>p.id!==socket.id&&p.connected!==false&&!p.isBot);if(next)r.hostId=next.id;}emitRoom(r);}
    break;
  }
}
app.get('/api/health',(_req,res)=>res.json({ok:true,rooms:rooms.size,cloudinary:cloudReady}));
restoreRooms();
for(const r of rooms.values()){if(r.status==='auction'&&r.currentAuction&&!r.paused){if(r.currentAuction.endsAt<=Date.now())closeAuction(r);else{scheduleTimer(r);scheduleBotBids(r);}}else if(r.status==='auction'&&!r.currentAuction&&!r.paused){r.transitionTimer=setTimeout(()=>advanceAuction(r.code),1200);}}
server.listen(PORT,'0.0.0.0',()=>console.log(`Auction game running on port ${PORT}`));
