const OCM_ENDPOINT = "https://api.openchargemap.io/v3/poi/";
const TOMTOM_ENDPOINT = "https://api.tomtom.com/search/2/evsearch";
const state = {
  map:null,userLat:null,userLon:null,userMarker:null,stations:[],markers:new Map(),
  layer:null,source:"none",autoTimer:null,lastUpdated:null,chatStation:null,chatRef:null,chatListener:null,currentUser:null,confirmationResult:null,recaptchaVerifier:null,qrScanner:null,priceStation:null,tripRouteLayer:null,tripRouteCoords:[],tripDestination:null,routeFastMarkers:null,walletNfcReader:null
};

const el=id=>document.getElementById(id);
const map=L.map("map",{zoomControl:true}).setView([-37.8136,144.9631],10);
state.map=map;
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
  maxZoom:19,attribution:'&copy; OpenStreetMap contributors'
}).addTo(map);
state.layer=L.layerGroup().addTo(map);

const getKey=name=>localStorage.getItem(name)||"";
const ocmKey=()=>getKey("ocm_api_key");
const tomtomKey=()=>getKey("tomtom_api_key");
function setStatus(text){el("statusText").textContent=text}
function haversineKm(a,b,c,d){const R=6371,r=x=>x*Math.PI/180;const x=r(c-a),y=r(d-b);const q=Math.sin(x/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(q))}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function normalConnector(type=""){
  const t=type.toLowerCase();
  if(t.includes("combo")||t.includes("ccs")) return "CCS";
  if(t.includes("chademo")) return "CHAdeMO";
  if(t.includes("type2")||t.includes("62196")) return "Type 2";
  if(t.includes("tesla")||t.includes("nacs")) return "Tesla";
  return type||"Unknown";
}
function availabilitySummary(s){
  const counts={Available:0,Occupied:0,Reserved:0,OutOfService:0,Unknown:0};
  (s.points||[]).forEach(p=>counts[p.status]!==undefined?counts[p.status]++:counts.Unknown++);
  return counts;
}
function stationPower(s){return Math.max(0,...(s.points||[]).flatMap(p=>(p.connectors||[]).map(c=>Number(c.power)||0)))}
function connectorNames(s){return [...new Set((s.points||[]).flatMap(p=>(p.connectors||[]).map(c=>normalConnector(c.type))).filter(Boolean))]}
function isOperational(s){const a=availabilitySummary(s);return (a.Available+a.Occupied+a.Reserved+a.Unknown)>0}
function isOpen247(s){return s.open247===true}

async function loadChargers(){
  if(state.userLat==null)return setStatus("Tap “Use my location” first.");
  if(!ocmKey()&&!tomtomKey()){el("settingsDialog").showModal();return setStatus("Add at least one charger-data API key.");}
  el("refreshBtn").disabled=true;setStatus("Loading nearby chargers…");
  try{
    let loaded=false;
    if(tomtomKey()){
      try{await loadTomTom();loaded=true}catch(e){console.warn("TomTom unavailable, falling back",e)}
    }
    if(!loaded){
      if(!ocmKey())throw new Error("TomTom live service unavailable and no Open Charge Map key is saved.");
      await loadOCM();
    }
    state.lastUpdated=new Date();
    render();
    applyStationFromUrl();
    const source=state.source==="tomtom"?"Live occupancy enabled":"Location data only";
    setStatus(`${source} · updated ${state.lastUpdated.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`);
  }catch(e){console.error(e);setStatus(e.message||"Could not load charger information.")}
  finally{el("refreshBtn").disabled=false}
}

async function loadTomTom(){
  const radius=Math.min(Number(el("radiusSelect").value)*1000,100000);
  const params=new URLSearchParams({
    key:tomtomKey(),lat:state.userLat,lon:state.userLon,radius,
    limit:"100",view:"Unified"
  });
  const response=await fetch(`${TOMTOM_ENDPOINT}?${params}`);
  if(!response.ok)throw new Error(`TomTom EV service error ${response.status}`);
  const data=await response.json();
  state.stations=(data.results||[]).map(r=>{
    const points=(r.chargingStations||[]).flatMap(st=>(st.chargingPoints||[]).map(p=>({
      status:p.status||"Unknown",
      connectors:(p.connectors||[]).map(c=>({type:c.type,power:c.ratedPowerKW}))
    })));
    return{
      id:r.id,name:r.name||"EV Charger",lat:r.position.lat,lon:r.position.lon,
      address:r.address?.freeformAddress||[r.address?.streetNumber,r.address?.streetName,r.address?.municipality,r.address?.postalCode].filter(Boolean).join(" "),
      points,open247:r.openingHours?.mode==="nextSevenDays"&&false,
      distance:haversineKm(state.userLat,state.userLon,r.position.lat,r.position.lon),
      live:true,
      operator:r.operator?.name||r.brand?.name||r.poi?.brands?.[0]?.name||"",
      membership:r.accessType||r.restrictions||"",
      priceText:r.chargingPrice||r.price||r.tariff||"",
      rawPricing:r.chargingPrices||r.pricing||r.tariffs||r.costs||r.chargingPark||r
    };
  });
  state.source="tomtom";
}

async function loadOCM(){
  const params=new URLSearchParams({
    output:"json",latitude:state.userLat,longitude:state.userLon,
    distance:el("radiusSelect").value,distanceunit:"KM",maxresults:"500",
    compact:"true",verbose:"false",key:ocmKey()
  });
  const response=await fetch(`${OCM_ENDPOINT}?${params}`);
  if(!response.ok)throw new Error(`Open Charge Map error ${response.status}`);
  const data=await response.json();
  state.stations=data.map(s=>{
    const points=(s.Connections||[]).map(c=>({
      status:s.StatusType?.IsOperational===false?"OutOfService":"Unknown",
      connectors:[{type:c.ConnectionType?.Title,power:c.PowerKW}]
    }));
    return{
      id:s.ID,name:s.AddressInfo?.Title||"EV Charger",
      lat:s.AddressInfo.Latitude,lon:s.AddressInfo.Longitude,
      address:[s.AddressInfo.AddressLine1,s.AddressInfo.Town,s.AddressInfo.StateOrProvince,s.AddressInfo.Postcode].filter(Boolean).join(", "),
      points,open247:(s.AddressInfo?.AccessComments||"").toLowerCase().includes("24"),
      distance:haversineKm(state.userLat,state.userLon,s.AddressInfo.Latitude,s.AddressInfo.Longitude),
      live:false,
      usageCost:s.UsageCost||"",
      operator:s.OperatorInfo?.Title||"",
      membership:s.UsageType?.Title||"",
      rawPricing:{usageCost:s.UsageCost||"",accessComments:s.AddressInfo?.AccessComments||""}
    };
  });
  state.source="ocm";
}

function filteredStations(){
  const min=Number(el("powerFilter").value),conn=el("connectorFilter").value.toLowerCase();
  const availability=el("availabilityFilter").value;
  let result=state.stations.filter(s=>{
    const a=availabilitySummary(s);
    return stationPower(s)>=min&&(!conn||connectorNames(s).some(n=>n.toLowerCase().includes(conn)))&&
      (!availability||a[availability]>0)&&(!el("operationalFilter").checked||isOperational(s))&&
      (!el("openNowFilter").checked||isOpen247(s));
  });
  result.sort((a,b)=>el("sortSelect").value==="power"?stationPower(b)-stationPower(a):a.distance-b.distance);
  return result;
}
function markerIcon(s){
  const a=availabilitySummary(s),cls=a.Available>0?"available":a.Occupied>0?"occupied":"";
  return L.divIcon({className:"",html:`<div class="charger-marker ${stationPower(s)>=100?"fast":""} ${cls}">⚡</div>`,iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-14]});
}


function updateCarModeClock(){
  el("carModeClock").textContent=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
}
function updateCarModeSummary(){
  const stations=filteredStations();
  let total=0,available=0,occupied=0;
  stations.forEach(s=>(s.points||[]).forEach(p=>{
    total++;
    const status=String(p.status||"").toLowerCase();
    if(status==="available")available++;
    if(status==="occupied"||status==="inuse"||status==="in use")occupied++;
  }));
  el("carTotalCount").textContent=total;
  el("carAvailableCount").textContent=available;
  el("carOccupiedCount").textContent=occupied;
}
function openCarMode(){
  updateCarModeSummary();
  updateCarModeClock();
  el("carModeScreen").classList.remove("hidden");
  document.body.style.overflow="hidden";
}
function closeCarMode(){
  el("carModeScreen").classList.add("hidden");
  document.body.style.overflow="";
}
function applyCarModeUrl(){
  const params=new URLSearchParams(location.search);
  if(params.get("car")==="1"){
    setTimeout(openCarMode,300);
  }
}

function updateNearbySummary(stations){
  const totals={total:0,available:0,occupied:0,reserved:0,unavailable:0};

  stations.forEach(station=>{
    const points=station.points||[];
    totals.total+=points.length;

    points.forEach(point=>{
      const status=String(point.status||"Unknown").toLowerCase();
      if(status==="available")totals.available++;
      else if(status==="occupied"||status==="inuse"||status==="in use")totals.occupied++;
      else if(status==="reserved")totals.reserved++;
      else totals.unavailable++;
    });
  });

  el("summaryTotalPoints").textContent=totals.total;
  el("summaryAvailablePoints").textContent=totals.available;
  el("summaryOccupiedPoints").textContent=totals.occupied;
  el("summaryReservedPoints").textContent=totals.reserved;
  el("summaryUnavailablePoints").textContent=totals.unavailable;
}

function render(){
  const stations=filteredStations();
  el("resultCount").textContent=`${stations.length} charger${stations.length===1?"":"s"}`;
  updateNearbySummary(stations);
  state.layer.clearLayers();state.markers.clear();
  stations.forEach(s=>{
    const a=availabilitySummary(s);
    const live=s.live?`<br><b>${a.Available} available · ${a.Occupied} occupied</b>`:"<br>Live occupancy unavailable";
    const marker=L.marker([s.lat,s.lon],{icon:markerIcon(s)}).bindPopup(`<strong>${escapeHtml(s.name)}</strong><br>${stationPower(s)||"Unknown"} kW max${live}<br>${s.distance.toFixed(1)} km away`);
    marker.addTo(state.layer);state.markers.set(s.id,marker);
  });
  renderList(stations);
}
function renderList(stations){
  const list=el("chargerList");list.innerHTML="";
  if(!stations.length){list.innerHTML='<div class="empty">No chargers match these filters.</div>';return}
  const template=el("chargerCardTemplate");
  stations.forEach(s=>{
    const node=template.content.cloneNode(true),a=availabilitySummary(s),power=stationPower(s);
    node.querySelector(".charger-card").dataset.stationId=String(s.id);
    node.querySelector(".charger-name").textContent=s.name;
    node.querySelector(".charger-address").textContent=s.address;
    node.querySelector(".distance-badge").textContent=`${s.distance.toFixed(1)} km`;
    const chips=node.querySelector(".chips");
    const add=(text,cls="")=>{const x=document.createElement("span");x.className=`chip ${cls}`;x.textContent=text;chips.appendChild(x)};
    add(power?`${power} kW max`:"Power unknown",power>=100?"fast":"");
    connectorNames(s).slice(0,4).forEach(x=>add(x));
    if(stationPriceRows(s).length)add("Price available","price-chip");
    else add("Price unavailable","unknown");
    if(s.live){
      add(`${a.Available} available`,"available");
      add(`${a.Occupied} occupied`,"occupied");
      if(a.Reserved)add(`${a.Reserved} reserved`,"reserved");
      if(a.OutOfService)add(`${a.OutOfService} out of service`,"outofservice");
      if(a.Unknown)add(`${a.Unknown} unknown`,"unknown");
    }else add("Live occupancy unavailable","unknown");
    node.querySelector(".map-btn").addEventListener("click",()=>{map.setView([s.lat,s.lon],16);state.markers.get(s.id)?.openPopup()});
    node.querySelector(".chat-btn").addEventListener("click",()=>openChat(s));
    node.querySelector(".price-btn").addEventListener("click",()=>showStationPrice(s));
    node.querySelector(".navigate-btn").href=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat+","+s.lon)}`;
    list.appendChild(node);
  });
}

function firebaseConfig(){
  return {
    apiKey:getKey("firebase_api_key"),
    databaseURL:getKey("firebase_database_url"),
    projectId:getKey("firebase_project_id"),
    authDomain:getKey("firebase_auth_domain"),
    appId:getKey("firebase_app_id")
  };
}
function firebaseReady(){
  const c=firebaseConfig();
  return Boolean(c.apiKey&&c.databaseURL&&c.projectId&&c.authDomain&&c.appId&&window.firebase);
}
function safeStationKey(id){return String(id).replace(/[.#$\[\]\/]/g,"_").slice(0,120)}
function initFirebase(){
  if(!firebaseReady())return null;
  try{
    if(!firebase.apps.length)firebase.initializeApp(firebaseConfig());
    return firebase.database();
  }catch(e){
    console.error("Firebase init failed",e);
    return null;
  }
}
function formatChatTime(ts){
  if(!ts)return "";
  const d=new Date(ts);
  return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
}
function renderChatMessages(messages){
  const box=el("chatMessages");box.innerHTML="";
  if(!messages.length){box.innerHTML='<div class="empty">No messages yet. Be the first to update other drivers.</div>';return}
  messages.forEach(m=>{
    const item=document.createElement("article");item.className="chat-message";
    const finish=m.finishMinutes?`<span class="finish-estimate">Leaving in about ${m.finishMinutes==60?"1 hour":m.finishMinutes+" min"}</span>`:"";
    item.innerHTML=`<div class="chat-message-head"><span class="chat-author">${escapeHtml(m.name||"Driver")}</span><span class="chat-time">${formatChatTime(m.createdAt)}</span></div><p>${escapeHtml(m.message||"")}</p>${finish}`;
    box.appendChild(item);
  });
  box.scrollTop=box.scrollHeight;
}

function authReady(){
  return Boolean(initFirebase() && firebase.auth);
}
function authMessage(text,isError=false){
  el("authStatus").textContent=text;
  el("authStatus").style.color=isError?"#ff9c9c":"";
}
function displayUserLabel(user){
  if(!user)return "Sign in";
  return user.displayName||user.email||user.phoneNumber||"Account";
}
function updateAuthUI(user){
  state.currentUser=user||null;
  el("accountBtn").textContent=displayUserLabel(user);
  const signed=Boolean(user);
  el("signedInPanel").classList.toggle("hidden",!signed);
  el("googleSignInBtn").classList.toggle("hidden",signed);
  document.querySelectorAll(".auth-section,.auth-separator").forEach(x=>x.classList.toggle("hidden",signed));
  if(signed){
    const name=user.displayName||"Signed-in user";
    const detail=user.email||user.phoneNumber||user.uid;
    el("signedInName").textContent=name;
    el("signedInDetail").textContent=detail;
    const avatar=el("userAvatar");
    avatar.innerHTML="";
    if(user.photoURL){
      const img=document.createElement("img");img.src=user.photoURL;img.alt="";avatar.appendChild(img);
    }else avatar.textContent=(name[0]||"U").toUpperCase();
    authMessage("You are signed in.");
  }else{
    authMessage("Choose a sign-in method.");
  }
}
function openAuth(){
  el("authDialog").showModal();
  if(!authReady())authMessage("Firebase Authentication is not configured yet. Add Firebase settings using the gear icon.",true);
}
function closeAuth(){
  el("authDialog").close();
}
async function signInGoogle(){
  if(!authReady())return authMessage("Firebase Authentication is not configured.",true);
  try{
    const provider=new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
  }catch(err){
    console.error(err);
    authMessage(err.message||"Google sign-in failed.",true);
  }
}
async function emailLogin(){
  if(!authReady())return authMessage("Firebase Authentication is not configured.",true);
  const email=el("authEmailInput").value.trim(),password=el("authPasswordInput").value;
  if(!email||!password)return authMessage("Enter your email and password.",true);
  try{
    await firebase.auth().signInWithEmailAndPassword(email,password);
  }catch(err){console.error(err);authMessage(err.message||"Sign-in failed.",true)}
}
async function emailRegister(){
  if(!authReady())return authMessage("Firebase Authentication is not configured.",true);
  const email=el("authEmailInput").value.trim(),password=el("authPasswordInput").value;
  if(!email||password.length<6)return authMessage("Enter a valid email and a password with at least 6 characters.",true);
  try{
    await firebase.auth().createUserWithEmailAndPassword(email,password);
    authMessage("Account created successfully.");
  }catch(err){console.error(err);authMessage(err.message||"Registration failed.",true)}
}
async function forgotPassword(){
  if(!authReady())return authMessage("Firebase Authentication is not configured.",true);
  const email=el("authEmailInput").value.trim();
  if(!email)return authMessage("Enter your email address first.",true);
  try{
    await firebase.auth().sendPasswordResetEmail(email);
    authMessage("Password reset email sent.");
  }catch(err){console.error(err);authMessage(err.message||"Could not send password reset email.",true)}
}
function setupRecaptcha(){
  if(state.recaptchaVerifier)return state.recaptchaVerifier;
  state.recaptchaVerifier=new firebase.auth.RecaptchaVerifier("recaptcha-container",{
    size:"invisible",
    callback:()=>{}
  });
  return state.recaptchaVerifier;
}
async function sendPhoneCode(){
  if(!authReady())return authMessage("Firebase Authentication is not configured.",true);
  const phone=el("phoneNumberInput").value.trim();
  if(!phone.startsWith("+"))return authMessage("Enter the phone number with country code, for example +61.",true);
  try{
    authMessage("Sending SMS code…");
    const verifier=setupRecaptcha();
    state.confirmationResult=await firebase.auth().signInWithPhoneNumber(phone,verifier);
    el("smsCodeArea").classList.remove("hidden");
    authMessage("SMS code sent.");
  }catch(err){
    console.error(err);
    if(state.recaptchaVerifier){state.recaptchaVerifier.clear();state.recaptchaVerifier=null}
    authMessage(err.message||"Could not send SMS code.",true);
  }
}
async function verifyPhoneCode(){
  const code=el("smsCodeInput").value.trim();
  if(!state.confirmationResult||code.length<6)return authMessage("Enter the 6-digit SMS code.",true);
  try{
    await state.confirmationResult.confirm(code);
    state.confirmationResult=null;
    el("smsCodeArea").classList.add("hidden");
  }catch(err){console.error(err);authMessage(err.message||"Verification failed.",true)}
}
async function signOutUser(){
  try{await firebase.auth().signOut()}catch(err){console.error(err);authMessage("Could not sign out.",true)}
}
function initialiseAuthObserver(){
  const db=initFirebase();
  if(!db||!firebase.auth)return;
  firebase.auth().onAuthStateChanged(updateAuthUI);
}

function openChat(station){
  if(!state.currentUser){
    openAuth();
    authMessage("Please sign in before using charger chat.",true);
    return;
  }
  state.chatStation=station;
  el("chatNameInput").value=displayUserLabel(state.currentUser);
  el("chatStationName").textContent=station.name;
  el("chatMessages").innerHTML='<div class="empty">Connecting…</div>';
  el("chatDialog").showModal();
  const db=initFirebase();
  if(!db){
    el("chatConnectionStatus").textContent="Live chat needs Firebase settings. Open the gear icon to configure it.";
    el("chatMessages").innerHTML='<div class="empty">Chat is not configured yet.</div>';
    return;
  }
  el("chatConnectionStatus").textContent="Live · messages for this charger";
  if(state.chatRef&&state.chatListener)state.chatRef.off("value",state.chatListener);
  const cutoff=Date.now()-24*60*60*1000;
  state.chatRef=db.ref(`chargerChats/${safeStationKey(station.id)}/messages`).orderByChild("createdAt").startAt(cutoff).limitToLast(100);
  state.chatListener=state.chatRef.on("value",snap=>{
    const messages=[];
    snap.forEach(child=>messages.push(child.val()));
    renderChatMessages(messages);
  },err=>{
    console.error(err);
    el("chatConnectionStatus").textContent="Chat connection failed. Check Firebase rules and settings.";
  });
}
function closeChat(){
  if(state.chatRef&&state.chatListener)state.chatRef.off("value",state.chatListener);
  state.chatRef=null;state.chatListener=null;state.chatStation=null;
  el("chatDialog").close();
}





function walletCards(){
  try{return JSON.parse(localStorage.getItem("chargemate_wallet_cards")||"[]")}catch(_){return []}
}
function saveWalletCards(cards){
  localStorage.setItem("chargemate_wallet_cards",JSON.stringify(cards));
}
function maskWalletNumber(value){
  const text=String(value||"").replace(/\s+/g,"");
  if(!text)return "NO NUMBER SAVED";
  if(text.length<=4)return `•••• ${text}`;
  return `${"•".repeat(Math.min(8,text.length-4))} ${text.slice(-4)}`;
}
function networkAccountUrl(network){
  const urls={
    "Chargefox":"https://www.chargefox.com/",
    "bp pulse":"https://www.bppulse.com/en-au/",
    "Evie Networks":"https://goevie.com.au/",
    "NRMA":"https://www.mynrma.com.au/electric-vehicles",
    "Exploren":"https://exploren.com.au/",
    "Wevolt":"https://wevolt.com.au/",
    "Everty":"https://everty.com.au/",
    "EVX":"https://evx.tech/",
    "Tesla":"https://www.tesla.com/charging"
  };
  return urls[network]||"";
}
function renderWalletCards(){
  const cards=walletCards();
  const list=el("walletCardsList");
  list.innerHTML="";
  el("walletCardCount").textContent=`${cards.length} card${cards.length===1?"":"s"}`;
  if(!cards.length){
    list.innerHTML='<div class="wallet-empty">No cards saved yet.</div>';
    return;
  }
  cards.forEach(card=>{
    const item=document.createElement("article");
    item.className="wallet-card";
    const link=card.accountLink||networkAccountUrl(card.network);
    item.innerHTML=`<div class="wallet-card-top"><span class="wallet-network">${escapeHtml(card.network)}</span><span class="wallet-card-type">RFID reference</span></div><div class="wallet-card-number">${escapeHtml(maskWalletNumber(card.cardNumber))}</div><div class="wallet-card-nickname">${escapeHtml(card.nickname||"Charging card")}</div><div class="wallet-card-actions">${link?`<a class="secondary-btn" target="_blank" rel="noopener" href="${escapeHtml(link)}">Open network</a>`:""}<button class="secondary-btn wallet-delete-btn" type="button">Delete</button></div>`;
    item.querySelector(".wallet-delete-btn").addEventListener("click",()=>{
      saveWalletCards(walletCards().filter(x=>x.id!==card.id));
      seedDemoWallet();
  renderWalletCards();
    });
    list.appendChild(item);
  });
}

function seedDemoWallet(){
  if(walletCards().length)return;
  saveWalletCards([
    {id:"demo-chargefox",network:"Chargefox",nickname:"Main Chargefox card",cardNumber:"CFX12345678",accountLink:"https://www.chargefox.com/",createdAt:Date.now()},
    {id:"demo-bp",network:"bp pulse",nickname:"bp pulse card",cardNumber:"BP99887766",accountLink:"https://www.bppulse.com/en-au/",createdAt:Date.now()}
  ]);
}

function openWallet(){
  if(!state.currentUser && state.source!=="demo"){
    openAuth();
    authMessage("Please sign in before opening your charging-card wallet.",true);
    return;
  }
  renderWalletCards();
  el("walletActivationStatus").textContent=localStorage.getItem("chargemate_wallet_active")==="true"?"Wallet activated.":"Wallet activation has not been completed.";
  el("walletDialog").showModal();
}
function closeWallet(){el("walletDialog").close()}
function saveWalletCard(){
  const network=el("walletNetworkInput").value;
  const nickname=el("walletNicknameInput").value.trim();
  const cardNumber=el("walletCardNumberInput").value.trim();
  const accountLink=el("walletAccountLinkInput").value.trim();
  if(!nickname&&!cardNumber)return el("walletActivationStatus").textContent="Enter a nickname or printed card number.";
  const cards=walletCards();
  cards.unshift({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),network,nickname,cardNumber,accountLink,createdAt:Date.now()});
  saveWalletCards(cards);
  el("walletNicknameInput").value="";
  el("walletCardNumberInput").value="";
  el("walletAccountLinkInput").value="";
  renderWalletCards();
  el("walletActivationStatus").textContent="Card reference saved securely on this device.";
}
async function scanWalletNfc(){
  if(!("NDEFReader"in window)){
    el("walletActivationStatus").textContent="Web NFC is not supported by this browser. Enter the printed card number manually.";
    return;
  }
  try{
    const reader=new NDEFReader();
    state.walletNfcReader=reader;
    el("walletActivationStatus").textContent="Hold a compatible NFC tag near the phone…";
    await reader.scan();
    reader.addEventListener("reading",event=>{
      let text="";
      for(const record of event.message.records){
        if(record.recordType==="text"){
          text=new TextDecoder(record.encoding||"utf-8").decode(record.data);
          break;
        }
        if(record.recordType==="url"){
          text=new TextDecoder().decode(record.data);
          break;
        }
      }
      el("walletCardNumberInput").value=text||event.serialNumber||"";
      el("walletActivationStatus").textContent=text?"Compatible NFC tag read. Review and save it.":"The tag was detected but no readable NDEF card reference was found.";
    },{once:true});
  }catch(err){
    console.error(err);
    el("walletActivationStatus").textContent="NFC scan failed or permission was denied.";
  }
}
async function activateWallet(){
  if(localStorage.getItem("chargemate_wallet_active")==="true"){
    el("walletActivationStatus").textContent="Wallet is already activated.";
    return;
  }
  const endpoint=getKey("wallet_checkout_endpoint");
  if(!endpoint){
    el("walletActivationStatus").textContent="Add a secure wallet checkout endpoint in Settings before charging the $1 fee.";
    return;
  }
  if(!state.currentUser){
    openAuth();
    return;
  }
  el("activateWalletBtn").disabled=true;
  el("walletActivationStatus").textContent="Creating secure $1 checkout…";
  try{
    const token=await state.currentUser.getIdToken();
    const response=await fetch(endpoint,{
      method:"POST",
      headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
      body:JSON.stringify({amountAudCents:100,product:"chargemate_card_wallet",successUrl:location.href,cancelUrl:location.href})
    });
    if(!response.ok)throw new Error(`Checkout service error ${response.status}`);
    const data=await response.json();
    if(!data.checkoutUrl)throw new Error("Checkout URL was not returned.");
    location.href=data.checkoutUrl;
  }catch(err){
    console.error(err);
    el("walletActivationStatus").textContent=err.message||"Checkout could not be started.";
  }finally{el("activateWalletBtn").disabled=false}
}
function applyWalletCheckoutResult(){
  const params=new URLSearchParams(location.search);
  if(params.get("wallet")=="success"){
    localStorage.setItem("chargemate_wallet_active","true");
    history.replaceState({},document.title,location.pathname);
  }
}

function orsKey(){return getKey("ors_api_key")}
function vehicleEndpoint(){return getKey("vehicle_api_endpoint")}
function setTripStatus(text){el("tripPlannerStatus").textContent=text}
function saveVehicleProfile(){
  const profile={
    name:el("vehicleNameInput").value.trim(),
    capacity:Number(el("batteryCapacityInput").value),
    charge:Number(el("currentChargeInput").value),
    efficiency:Number(el("efficiencyInput").value),
    reserve:Number(el("reserveInput").value),
    minFast:Number(el("tripFastPowerInput").value)
  };
  localStorage.setItem("ev_vehicle_profile",JSON.stringify(profile));
  return profile;
}
function loadVehicleProfile(){
  try{
    const p=JSON.parse(localStorage.getItem("ev_vehicle_profile")||"{}");
    if(p.name)el("vehicleNameInput").value=p.name;
    if(p.capacity)el("batteryCapacityInput").value=p.capacity;
    if(p.charge)el("currentChargeInput").value=p.charge;
    if(p.efficiency)el("efficiencyInput").value=p.efficiency;
    if(p.reserve!==undefined)el("reserveInput").value=p.reserve;
    if(p.minFast)el("tripFastPowerInput").value=p.minFast;
  }catch(_){}
}
function validateVehicle(profile){
  if(!profile.capacity||profile.capacity<10)return "Enter a valid battery capacity.";
  if(!profile.charge||profile.charge<1||profile.charge>100)return "Enter the current battery percentage.";
  if(!profile.efficiency||profile.efficiency<5)return "Enter the vehicle efficiency.";
  return "";
}
function openTripPlanner(){
  loadVehicleProfile();
  if(!state.userLat||!state.userLon)setTripStatus("Use your location on the main map before planning a trip.");
  el("tripDialog").showModal();
}
function closeTripPlanner(){el("tripDialog").close()}
async function geocodeDestination(query){
  if(state.source==="demo")return {lat:-37.7530,lon:144.9631,label:query||"Demo destination"};
  const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const response=await fetch(url,{headers:{"Accept":"application/json"}});
  if(!response.ok)throw new Error("Destination search failed.");
  const results=await response.json();
  if(!results.length)throw new Error("Destination could not be found.");
  return {lat:Number(results[0].lat),lon:Number(results[0].lon),label:results[0].display_name};
}

async function getDemoRoute(start,destination){
  const coords=[
    [start.lat,start.lon],
    [-37.8060,144.9740],
    [-37.8120,144.9900],
    [destination.lat,destination.lon]
  ];
  return {coords,distanceKm:28.4,durationSec:2100};
}

async function getRoute(start,destination){
  if(state.source==="demo")return getDemoRoute(start,destination);
  if(!orsKey())throw new Error("Add an OpenRouteService API key in Settings.");
  const response=await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson",{
    method:"POST",
    headers:{"Authorization":orsKey(),"Content-Type":"application/json"},
    body:JSON.stringify({coordinates:[[start.lon,start.lat],[destination.lon,destination.lat]],instructions:false})
  });
  if(!response.ok)throw new Error(`Route service error ${response.status}.`);
  const data=await response.json();
  const feature=data.features?.[0];
  if(!feature)throw new Error("No driving route was returned.");
  return {
    coords:feature.geometry.coordinates.map(([lon,lat])=>[lat,lon]),
    distanceKm:feature.properties.summary.distance/1000,
    durationSec:feature.properties.summary.duration
  };
}
function formatDuration(sec){
  const mins=Math.round(sec/60),h=Math.floor(mins/60),m=mins%60;
  return h?`${h}h ${m}m`:`${m} min`;
}
function calculateTripEnergy(route,profile){
  const batteryAvailable=profile.capacity*(profile.charge/100);
  const energyUsed=route.distanceKm*(profile.efficiency/100);
  const remainingKwh=batteryAvailable-energyUsed;
  const arrivalPercent=(remainingKwh/profile.capacity)*100;
  const fullRange=profile.capacity/profile.efficiency*100;
  const startingRange=fullRange*(profile.charge/100);
  const arrivalRange=Math.max(0,fullRange*(Math.max(0,arrivalPercent)/100));
  return {batteryAvailable,energyUsed,remainingKwh,arrivalPercent,fullRange,startingRange,arrivalRange};
}
function renderTripSafety(calc,profile){
  const banner=el("tripSafetyBanner");
  const arrival=calc.arrivalPercent;
  if(arrival<0){
    banner.className="trip-safety-banner danger";
    banner.textContent=`⚠ Not enough charge. The vehicle is estimated to run out about ${Math.abs(calc.arrivalRange).toFixed(0)} km before arrival. Add a charging stop.`;
  }else if(arrival<profile.reserve){
    banner.className="trip-safety-banner warning";
    banner.textContent=`⚠ Low arrival charge: approximately ${Math.max(0,arrival).toFixed(0)}%. This is below your ${profile.reserve}% safety reserve.`;
  }else{
    banner.className="trip-safety-banner safe";
    banner.textContent=`✓ Route looks achievable with an estimated ${arrival.toFixed(0)}% battery remaining at the destination.`;
  }
}
function pointToSegmentDistanceKm(p,a,b){
  const latScale=111.32;
  const lonScale=111.32*Math.cos(p.lat*Math.PI/180);
  const px=p.lon*lonScale,py=p.lat*latScale;
  const ax=a[1]*lonScale,ay=a[0]*latScale,bx=b[1]*lonScale,by=b[0]*latScale;
  const dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function distanceToRouteKm(station,coords){
  let best=Infinity;
  for(let i=1;i<coords.length;i+=Math.max(1,Math.floor(coords.length/250))){
    best=Math.min(best,pointToSegmentDistanceKm({lat:station.lat,lon:station.lon},coords[i-1],coords[i]));
  }
  return best;
}
function sampleRoute(coords,maxSamples=12){
  if(coords.length<=maxSamples)return coords;
  const samples=[];
  for(let i=0;i<maxSamples;i++)samples.push(coords[Math.round(i*(coords.length-1)/(maxSamples-1))]);
  return samples;
}
async function fetchFastChargersAlongRoute(coords,minPower){
  if(state.source==="demo"){
    return state.stations.filter(s=>stationPower(s)>=minPower).map(s=>({
      id:s.id,name:s.name,lat:s.lat,lon:s.lon,address:s.address,
      power:stationPower(s),operator:s.operator||"",connectors:connectorNames(s),corridorKm:Math.max(0.5,s.distance/2)
    }));
  }
  if(!ocmKey())return [];
  const samples=sampleRoute(coords,12);
  const found=new Map();
  for(const [lat,lon] of samples){
    const params=new URLSearchParams({
      output:"json",latitude:lat,longitude:lon,distance:"20",distanceunit:"KM",
      maxresults:"100",compact:"true",verbose:"false",key:ocmKey()
    });
    try{
      const r=await fetch(`${OCM_ENDPOINT}?${params}`);
      if(!r.ok)continue;
      const data=await r.json();
      data.forEach(s=>{
        const maxPower=Math.max(0,...(s.Connections||[]).map(c=>Number(c.PowerKW)||0));
        if(maxPower>=minPower){
          found.set(String(s.ID),{
            id:s.ID,name:s.AddressInfo?.Title||"Fast charger",
            lat:s.AddressInfo.Latitude,lon:s.AddressInfo.Longitude,
            address:[s.AddressInfo.AddressLine1,s.AddressInfo.Town,s.AddressInfo.StateOrProvince].filter(Boolean).join(", "),
            power:maxPower,operator:s.OperatorInfo?.Title||"",
            connectors:[...new Set((s.Connections||[]).map(c=>c.ConnectionType?.Title).filter(Boolean))]
          });
        }
      });
    }catch(_){}
  }
  return [...found.values()]
    .map(s=>({...s,corridorKm:distanceToRouteKm(s,coords)}))
    .filter(s=>s.corridorKm<=10)
    .sort((a,b)=>a.corridorKm-b.corridorKm||b.power-a.power)
    .slice(0,30);
}
function clearTripMap(){
  if(state.tripRouteLayer){state.tripRouteLayer.remove();state.tripRouteLayer=null}
  if(state.routeFastMarkers){state.routeFastMarkers.remove();state.routeFastMarkers=null}
}
function drawTripRoute(route,chargers){
  clearTripMap();
  state.tripRouteLayer=L.polyline(route.coords,{weight:6,opacity:.9}).addTo(map);
  state.routeFastMarkers=L.layerGroup().addTo(map);
  chargers.forEach(s=>{
    L.marker([s.lat,s.lon],{icon:markerIcon({points:[{status:"Available",connectors:[{power:s.power}]}]})})
      .bindPopup(`<div class="route-popup"><strong>${escapeHtml(s.name)}</strong><br>${s.power} kW fast charger<br>${s.corridorKm.toFixed(1)} km from route</div>`)
      .addTo(state.routeFastMarkers);
  });
  map.fitBounds(state.tripRouteLayer.getBounds(),{padding:[25,25]});
}
function renderRouteChargers(chargers){
  const list=el("routeChargersList");
  list.innerHTML="";
  el("routeChargerCount").textContent=`${chargers.length} found`;
  if(!chargers.length){
    list.innerHTML='<div class="empty">No matching fast chargers were found within about 10 km of this route.</div>';
    return;
  }
  chargers.forEach(s=>{
    const card=document.createElement("article");
    card.className="route-charger-card";
    card.innerHTML=`<div><h4>${escapeHtml(s.name)}</h4><p>${escapeHtml(s.address||s.operator||"Charging station")}</p><div class="route-charger-stats"><span>${s.power} kW</span><span>${s.corridorKm.toFixed(1)} km from route</span>${s.connectors.slice(0,2).map(c=>`<span>${escapeHtml(c)}</span>`).join("")}</div></div><div class="route-charger-actions"><button class="secondary-btn route-map-button">Map</button><a class="primary-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat+","+s.lon)}">Navigate</a></div>`;
    card.querySelector(".route-map-button").addEventListener("click",()=>{
      closeTripPlanner();map.setView([s.lat,s.lon],16);
    });
    list.appendChild(card);
  });
}
async function planTrip(){
  if(!state.userLat||!state.userLon)return setTripStatus("Use your current location on the main map first.");
  const profile=saveVehicleProfile();
  const error=validateVehicle(profile);
  if(error)return setTripStatus(error);
  const query=el("destinationInput").value.trim();
  if(!query)return setTripStatus("Enter a destination.");
  el("planTripBtn").disabled=true;
  setTripStatus("Finding destination and calculating your route…");
  try{
    const destination=await geocodeDestination(query);
    const route=await getRoute({lat:state.userLat,lon:state.userLon},destination);
    state.tripDestination=destination;
    state.tripRouteCoords=route.coords;
    const calc=calculateTripEnergy(route,profile);

    el("tripDistanceValue").textContent=`${route.distanceKm.toFixed(0)} km`;
    el("tripDurationValue").textContent=formatDuration(route.durationSec);
    el("arrivalChargeValue").textContent=`${Math.max(0,calc.arrivalPercent).toFixed(0)}%`;
    el("arrivalRangeValue").textContent=`${calc.arrivalRange.toFixed(0)} km`;
    el("startingRangeValue").textContent=`${calc.startingRange.toFixed(0)} km`;
    el("energyUsedValue").textContent=`${calc.energyUsed.toFixed(1)} kWh`;
    el("reserveValue").textContent=`${profile.reserve}%`;
    renderTripSafety(calc,profile);
    el("tripResults").classList.remove("hidden");
    el("startNavigationBtn").href=`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(state.userLat+","+state.userLon)}&destination=${encodeURIComponent(destination.lat+","+destination.lon)}&travelmode=driving`;

    setTripStatus("Route calculated. Searching for fast chargers along the way…");
    const chargers=await fetchFastChargersAlongRoute(route.coords,profile.minFast);
    renderRouteChargers(chargers);
    drawTripRoute(route,chargers);
    setTripStatus(`Route ready to ${destination.label}. Energy use is an estimate and will vary with speed, weather, terrain, payload and climate control.`);
  }catch(err){
    console.error(err);
    setTripStatus(err.message||"The route could not be calculated.");
  }finally{
    el("planTripBtn").disabled=false;
  }
}
async function syncConnectedVehicle(){
  if(!vehicleEndpoint())return el("vehicleSyncStatus").textContent="Add a secure connected-vehicle API endpoint in Settings.";
  if(!state.currentUser)return el("vehicleSyncStatus").textContent="Sign in before syncing a connected vehicle.";
  el("syncVehicleBtn").disabled=true;
  el("vehicleSyncStatus").textContent="Reading live vehicle information…";
  try{
    const token=await state.currentUser.getIdToken();
    const response=await fetch(vehicleEndpoint(),{headers:{"Authorization":`Bearer ${token}`}});
    if(!response.ok)throw new Error(`Vehicle service error ${response.status}`);
    const data=await response.json();
    if(data.name)el("vehicleNameInput").value=data.name;
    if(data.batteryCapacityKwh)el("batteryCapacityInput").value=data.batteryCapacityKwh;
    if(data.percentRemaining!==undefined)el("currentChargeInput").value=Math.round(data.percentRemaining<=1?data.percentRemaining*100:data.percentRemaining);
    if(data.efficiencyKwhPer100Km)el("efficiencyInput").value=data.efficiencyKwhPer100Km;
    el("vehicleSyncStatus").textContent=`Live vehicle synced${data.rangeKm?` · ${Math.round(data.rangeKm)} km range reported`:""}.`;
    saveVehicleProfile();
  }catch(err){
    console.error(err);
    el("vehicleSyncStatus").textContent=err.message||"Vehicle sync failed.";
  }finally{el("syncVehicleBtn").disabled=false}
}

function cleanPriceText(value){
  if(value===null||value===undefined)return "";
  if(typeof value==="string"||typeof value==="number")return String(value).trim();
  return "";
}
function collectPriceFields(value,path="",out=[]){
  if(value===null||value===undefined)return out;
  if(Array.isArray(value)){
    value.forEach((item,i)=>collectPriceFields(item,`${path}[${i}]`,out));
    return out;
  }
  if(typeof value==="object"){
    Object.entries(value).forEach(([key,val])=>{
      const next=path?`${path}.${key}`:key;
      if(/price|cost|tariff|fee|currency|rate/i.test(key)){
        const text=cleanPriceText(val);
        if(text)out.push({label:key.replace(/([A-Z])/g," $1").replace(/[_-]/g," ").trim(),value:text});
      }
      collectPriceFields(val,next,out);
    });
  }
  return out;
}
function dedupePriceRows(rows){
  const seen=new Set();
  return rows.filter(row=>{
    const key=`${row.label}|${row.value}`.toLowerCase();
    if(!row.value||seen.has(key))return false;
    seen.add(key);return true;
  }).slice(0,12);
}
function stationPriceRows(station){
  const rows=[];
  if(station.usageCost)rows.push({label:"Usage cost",value:station.usageCost});
  if(station.priceText)rows.push({label:"Tariff",value:station.priceText});
  if(station.operator)rows.push({label:"Network",value:station.operator});
  if(station.membership)rows.push({label:"Access",value:station.membership});
  if(station.rawPricing)rows.push(...collectPriceFields(station.rawPricing));
  return dedupePriceRows(rows);
}
function stationPriceSummary(station){
  const rows=stationPriceRows(station);
  const priceRow=rows.find(r=>/usage cost|tariff|price|rate|fee/i.test(r.label));
  return priceRow?.value||"Price information is not supplied for this station.";
}
function showStationPrice(station){
  state.priceStation=station;
  el("priceStationName").textContent=station.name||"Charging station";
  el("priceStationMeta").textContent=`Station ID: ${station.id} · ${station.distance.toFixed(1)} km away`;

  const rows=stationPriceRows(station);
  const summary=el("priceSummary");
  summary.textContent=stationPriceSummary(station);
  summary.classList.toggle("unavailable",rows.length===0);

  const breakdown=el("priceBreakdown");
  breakdown.innerHTML="";
  if(rows.length){
    rows.forEach(row=>{
      const item=document.createElement("div");
      item.className="price-row";
      const label=document.createElement("div");
      label.className="price-label";
      label.textContent=row.label;
      const value=document.createElement("div");
      value.className="price-value";
      value.textContent=row.value;
      item.append(label,value);
      breakdown.appendChild(item);
    });
  }

  el("priceNavigateBtn").href=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(station.lat+","+station.lon)}`;
  if(!el("priceDialog").open)el("priceDialog").showModal();
}
function closeStationPrice(){
  state.priceStation=null;
  if(el("priceDialog").open)el("priceDialog").close();
}

function normalizeStationId(value){
  const text=String(value||"").trim();
  if(!text)return "";
  try{
    const url=new URL(text);
    return url.searchParams.get("station")||url.searchParams.get("id")||"";
  }catch(_){}
  if(/^EVCHARGER:/i.test(text))return text.split(":").slice(1).join(":").trim();
  return text;
}
function stationMatchesId(station,id){
  const needle=String(id).trim().toLowerCase();
  if(!needle)return false;
  return String(station.id).toLowerCase()===needle ||
    String(station.name||"").toLowerCase().includes(needle);
}
function focusStationById(rawId){
  const id=normalizeStationId(rawId);
  if(!id){setStatus("Enter or scan a station ID.");return false}
  const station=state.stations.find(s=>stationMatchesId(s,id));
  if(!station){
    setStatus(`Station ID “${id}” was not found in the currently loaded area.`);
    return false;
  }
  map.setView([station.lat,station.lon],17);
  state.markers.get(station.id)?.openPopup();
  setStatus(`Opened station ${station.id}.`);
  const card=[...document.querySelectorAll(".charger-card")].find(c=>c.dataset.stationId===String(station.id));
  card?.scrollIntoView({behavior:"smooth",block:"center"});
  showStationPrice(station);
  return true;
}
async function openQrScanner(){
  el("qrDialog").showModal();
  el("qrStatus").textContent="Point your camera at a charger QR code.";
  if(!window.Html5Qrcode){
    el("qrStatus").textContent="QR scanner library could not load.";
    return;
  }
  try{
    state.qrScanner=new Html5Qrcode("qr-reader");
    await state.qrScanner.start(
      {facingMode:"environment"},
      {fps:10,qrbox:{width:250,height:250}},
      decoded=>{
        el("qrManualInput").value=decoded;
        if(focusStationById(decoded))closeQrScanner();
      },
      ()=>{}
    );
  }catch(err){
    console.error(err);
    el("qrStatus").textContent="Camera access failed. You can paste the QR text below.";
  }
}
async function closeQrScanner(){
  if(state.qrScanner){
    try{await state.qrScanner.stop()}catch(_){}
    try{await state.qrScanner.clear()}catch(_){}
    state.qrScanner=null;
  }
  if(el("qrDialog").open)el("qrDialog").close();
}
function applyStationFromUrl(){
  const id=new URLSearchParams(location.search).get("station");
  if(id){
    el("stationIdInput").value=id;
    setTimeout(()=>focusStationById(id),800);
  }
}


function loadDemoMode(){
  state.userLat=-37.8136;
  state.userLon=144.9631;
  map.setView([state.userLat,state.userLon],12);

  if(state.userMarker)state.userMarker.remove();
  state.userMarker=L.marker([state.userLat,state.userLon],{
    icon:L.divIcon({className:"",html:'<div class="user-marker"></div>',iconSize:[18,18],iconAnchor:[9,9]})
  }).addTo(map).bindPopup("Demo location");

  state.stations=[
    {
      id:"CFX-1001",
      name:"Chargefox Melbourne Central",
      lat:-37.8102,lon:144.9629,
      address:"300 Lonsdale Street, Melbourne VIC",
      distance:0.8,live:true,open247:true,
      operator:"Chargefox",
      usageCost:"A$0.60 per kWh",
      membership:"App or RFID card",
      points:[
        {status:"Available",connectors:[{type:"CCS",power:150}]},
        {status:"Occupied",connectors:[{type:"CCS",power:150}]}
      ]
    },
    {
      id:"BP-2204",
      name:"bp pulse Docklands",
      lat:-37.8178,lon:144.9465,
      address:"Harbour Esplanade, Docklands VIC",
      distance:2.1,live:true,open247:true,
      operator:"bp pulse",
      usageCost:"A$0.69 per kWh",
      membership:"App, card or contactless",
      points:[
        {status:"Available",connectors:[{type:"CCS",power:300}]},
        {status:"Available",connectors:[{type:"CCS",power:300}]}
      ]
    },
    {
      id:"EVIE-3308",
      name:"Evie Fast Charging Richmond",
      lat:-37.8248,lon:144.9981,
      address:"Swan Street, Richmond VIC",
      distance:4.0,live:true,open247:true,
      operator:"Evie Networks",
      usageCost:"A$0.65 per kWh",
      membership:"App or contactless",
      points:[
        {status:"Occupied",connectors:[{type:"CCS",power:350}]},
        {status:"Reserved",connectors:[{type:"CHAdeMO",power:50}]}
      ]
    },
    {
      id:"NRMA-4412",
      name:"NRMA Charging Hub",
      lat:-37.8004,lon:144.9794,
      address:"Carlton VIC",
      distance:2.7,live:false,open247:false,
      operator:"NRMA",
      usageCost:"Price varies by membership",
      membership:"NRMA app",
      points:[
        {status:"Unknown",connectors:[{type:"Type 2",power:22}]}
      ]
    }
  ];
  state.source="demo";
  render();
  setStatus("Demo mode · sample charger data loaded");

  let banner=document.querySelector(".demo-banner");
  if(!banner){
    banner=document.createElement("div");
    banner.className="demo-banner";
    banner.textContent="TEST DEMO MODE";
    document.body.appendChild(banner);
    setTimeout(()=>banner.remove(),3500);
  }
}

function locate(){
  setStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition(pos=>{
    state.userLat=pos.coords.latitude;state.userLon=pos.coords.longitude;map.setView([state.userLat,state.userLon],13);
    if(state.userMarker)state.userMarker.remove();
    state.userMarker=L.marker([state.userLat,state.userLon],{icon:L.divIcon({className:"",html:'<div class="user-marker"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map).bindPopup("You are here");
    loadChargers();
  },()=>setStatus("Location permission was denied or unavailable."),{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
}
function configureAutoRefresh(){
  if(state.autoTimer)clearInterval(state.autoTimer);
  state.autoTimer=null;
  if(el("autoRefreshFilter").checked)state.autoTimer=setInterval(loadChargers,30000);
}
el("locateBtn").addEventListener("click",locate);
el("demoModeBtn").addEventListener("click",loadDemoMode);
el("refreshBtn").addEventListener("click",loadChargers);
el("radiusSelect").addEventListener("change",loadChargers);
["powerFilter","connectorFilter","availabilityFilter","openNowFilter","operationalFilter","sortSelect"].forEach(id=>el(id).addEventListener("change",render));
el("autoRefreshFilter").addEventListener("change",configureAutoRefresh);
el("settingsBtn").addEventListener("click",()=>{
  el("apiKeyInput").value=ocmKey();
  el("tomtomKeyInput").value=tomtomKey();
  el("firebaseApiKeyInput").value=getKey("firebase_api_key");
  el("firebaseDatabaseUrlInput").value=getKey("firebase_database_url");
  el("firebaseProjectIdInput").value=getKey("firebase_project_id");
  el("firebaseAuthDomainInput").value=getKey("firebase_auth_domain");
  el("firebaseAppIdInput").value=getKey("firebase_app_id");
  el("orsApiKeyInput").value=getKey("ors_api_key");
  el("vehicleApiEndpointInput").value=getKey("vehicle_api_endpoint");
  el("walletCheckoutEndpointInput").value=getKey("wallet_checkout_endpoint");
  el("settingsDialog").showModal();
});
el("saveApiKeyBtn").addEventListener("click",()=>{
  const a=el("apiKeyInput").value.trim(),b=el("tomtomKeyInput").value.trim();
  a?localStorage.setItem("ocm_api_key",a):localStorage.removeItem("ocm_api_key");
  b?localStorage.setItem("tomtom_api_key",b):localStorage.removeItem("tomtom_api_key");
  const firebaseValues={
    firebase_api_key:el("firebaseApiKeyInput").value.trim(),
    firebase_database_url:el("firebaseDatabaseUrlInput").value.trim(),
    firebase_project_id:el("firebaseProjectIdInput").value.trim(),
    firebase_auth_domain:el("firebaseAuthDomainInput").value.trim(),
    firebase_app_id:el("firebaseAppIdInput").value.trim(),
    ors_api_key:el("orsApiKeyInput").value.trim(),
    vehicle_api_endpoint:el("vehicleApiEndpointInput").value.trim(),
    wallet_checkout_endpoint:el("walletCheckoutEndpointInput").value.trim()
  };
  Object.entries(firebaseValues).forEach(([k,v])=>v?localStorage.setItem(k,v):localStorage.removeItem(k));
  setTimeout(()=>state.userLat!=null&&loadChargers(),100);
});

el("closeChatBtn").addEventListener("click",closeChat);
el("chatDialog").addEventListener("cancel",e=>{e.preventDefault();closeChat()});
el("chatForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const db=initFirebase();
  if(!db||!state.chatStation)return;
  const user=state.currentUser;
  const name=user?.displayName||user?.email||user?.phoneNumber||"Driver";
  const message=el("chatMessageInput").value.trim();
  const finishMinutes=Number(el("finishTimeSelect").value)||0;
  if(!user||!message)return;
  const ref=db.ref(`chargerChats/${safeStationKey(state.chatStation.id)}/messages`).push();
  try{
    await ref.set({uid:user.uid,name,message,finishMinutes,createdAt:firebase.database.ServerValue.TIMESTAMP});
    el("chatMessageInput").value="";
    el("finishTimeSelect").value="";
  }catch(err){
    console.error(err);
    el("chatConnectionStatus").textContent="Message could not be sent. Check Firebase security rules.";
  }
});



el("accountBtn").addEventListener("click",openAuth);
el("closeAuthBtn").addEventListener("click",closeAuth);
el("authDialog").addEventListener("cancel",e=>{e.preventDefault();closeAuth()});
el("googleSignInBtn").addEventListener("click",signInGoogle);
el("emailLoginBtn").addEventListener("click",emailLogin);
el("emailRegisterBtn").addEventListener("click",emailRegister);
el("forgotPasswordBtn").addEventListener("click",forgotPassword);
el("sendCodeBtn").addEventListener("click",sendPhoneCode);
el("verifyCodeBtn").addEventListener("click",verifyPhoneCode);
el("signOutBtn").addEventListener("click",signOutUser);
initialiseAuthObserver();



el("closePriceBtn").addEventListener("click",closeStationPrice);
el("priceDialog").addEventListener("cancel",e=>{e.preventDefault();closeStationPrice()});
el("priceShowMapBtn").addEventListener("click",()=>{
  const s=state.priceStation;if(!s)return;
  closeStationPrice();
  map.setView([s.lat,s.lon],17);
  state.markers.get(s.id)?.openPopup();
});
el("priceOpenChatBtn").addEventListener("click",()=>{
  const s=state.priceStation;if(!s)return;
  closeStationPrice();
  openChat(s);
});

el("findStationBtn").addEventListener("click",()=>focusStationById(el("stationIdInput").value));
el("stationIdInput").addEventListener("keydown",e=>{if(e.key==="Enter")focusStationById(e.target.value)});
el("scanQrBtn").addEventListener("click",openQrScanner);
el("closeQrBtn").addEventListener("click",closeQrScanner);
el("qrDialog").addEventListener("cancel",e=>{e.preventDefault();closeQrScanner()});
el("useQrTextBtn").addEventListener("click",()=>{
  if(focusStationById(el("qrManualInput").value))closeQrScanner();
});



el("walletBtn").addEventListener("click",openWallet);
el("closeWalletBtn").addEventListener("click",closeWallet);
el("walletDialog").addEventListener("cancel",e=>{e.preventDefault();closeWallet()});
el("saveWalletCardBtn").addEventListener("click",saveWalletCard);
el("scanWalletNfcBtn").addEventListener("click",scanWalletNfc);
el("activateWalletBtn").addEventListener("click",activateWallet);
applyWalletCheckoutResult();

el("openTripPlannerBtn").addEventListener("click",openTripPlanner);
el("closeTripPlannerBtn").addEventListener("click",closeTripPlanner);
el("tripDialog").addEventListener("cancel",e=>{e.preventDefault();closeTripPlanner()});
el("planTripBtn").addEventListener("click",planTrip);
el("destinationInput").addEventListener("keydown",e=>{if(e.key==="Enter")planTrip()});
el("syncVehicleBtn").addEventListener("click",syncConnectedVehicle);
el("useMapCentreBtn").addEventListener("click",()=>{
  const c=map.getCenter();
  el("destinationInput").value=`${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
});
el("clearTripBtn").addEventListener("click",()=>{
  clearTripMap();state.tripRouteCoords=[];state.tripDestination=null;
  el("tripResults").classList.add("hidden");
  el("destinationInput").value="";
  setTripStatus("Route cleared.");
});
el("fitRouteBtn").addEventListener("click",()=>{
  if(state.tripRouteLayer){closeTripPlanner();map.fitBounds(state.tripRouteLayer.getBounds(),{padding:[25,25]})}
});
["vehicleNameInput","batteryCapacityInput","currentChargeInput","efficiencyInput","reserveInput","tripFastPowerInput"]
  .forEach(id=>el(id).addEventListener("change",saveVehicleProfile));
loadVehicleProfile();


el("carModeBtn").addEventListener("click",openCarMode);
el("exitCarModeBtn").addEventListener("click",closeCarMode);
el("carFindNearbyBtn").addEventListener("click",()=>{closeCarMode();map.invalidateSize();});
el("carPlanTripBtn").addEventListener("click",()=>{closeCarMode();openTripPlanner();});
el("carFastChargersBtn").addEventListener("click",()=>{
  closeCarMode();el("powerFilter").value="150";render();
});
el("carHomeBtn").addEventListener("click",()=>{});
el("carMapBtn").addEventListener("click",()=>{closeCarMode();map.invalidateSize();});
el("carTripsBtn").addEventListener("click",()=>{closeCarMode();openTripPlanner();});
el("carVoiceBtn").addEventListener("click",()=>alert("Voice control requires the native Android Auto or CarPlay app."));
setInterval(updateCarModeClock,30000);
applyCarModeUrl();

if("serviceWorker"in navigator)navigator.serviceWorker.register("service-worker.js");
setTimeout(()=>map.invalidateSize(),200);
