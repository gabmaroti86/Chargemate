const state={map:null,markers:[],chargers:[],user:null};
const $=id=>document.getElementById(id);
const demoChargers=[
 {name:"Chargefox Richmond",lat:-37.823,lon:145.001,power:350,status:"Available",distance:2.1,address:"Richmond VIC"},
 {name:"Evie Networks Abbotsford",lat:-37.803,lon:144.999,power:150,status:"Available",distance:3.4,address:"Abbotsford VIC"},
 {name:"bp pulse Southbank",lat:-37.827,lon:144.963,power:75,status:"Occupied",distance:4.8,address:"Southbank VIC"},
 {name:"Tesla Supercharger Melbourne",lat:-37.813,lon:144.953,power:250,status:"Available",distance:5.2,address:"Melbourne VIC"},
 {name:"Chargefox Brunswick",lat:-37.769,lon:144.961,power:50,status:"Available",distance:7.6,address:"Brunswick VIC"}
];

function init(){
 state.map=L.map("map").setView([-37.8136,144.9631],11);
 L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(state.map);
 bind();
 const saved=localStorage.getItem("chargemate_ocm_key"); if(saved) $("apiKeyInput").value=saved;
 if("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(()=>{});
}
function bind(){
 $("locateBtn").addEventListener("click",locate);
 $("demoBtn").addEventListener("click",()=>loadChargers(demoChargers,"Demo chargers loaded."));
 $("powerFilter").addEventListener("change",render);
 $("searchInput").addEventListener("input",render);
 $("tripBtn").addEventListener("click",()=>$("tripDialog").showModal());
 $("settingsBtn").addEventListener("click",()=>$("settingsDialog").showModal());
 $("saveSettingsBtn").addEventListener("click",()=>localStorage.setItem("chargemate_ocm_key",$("apiKeyInput").value.trim()));
 $("estimateBtn").addEventListener("click",estimateTrip);
}
function locate(){
 if(!navigator.geolocation){setStatus("Location is not supported on this device.");return}
 setStatus("Finding your location…");
 navigator.geolocation.getCurrentPosition(async p=>{
  state.user={lat:p.coords.latitude,lon:p.coords.longitude};
  state.map.setView([state.user.lat,state.user.lon],12);
  L.circleMarker([state.user.lat,state.user.lon],{radius:8}).addTo(state.map).bindPopup("Your location");
  await fetchNearby();
 },()=>setStatus("Location permission was not granted."),{enableHighAccuracy:true,timeout:10000});
}
async function fetchNearby(){
 const key=localStorage.getItem("chargemate_ocm_key")||"";
 const {lat,lon}=state.user;
 const url=new URL("https://api.openchargemap.io/v3/poi/");
 url.search=new URLSearchParams({output:"json",latitude:lat,longitude:lon,distance:"25",distanceunit:"KM",maxresults:"60",compact:"true",verbose:"false",key});
 try{
  setStatus("Loading live charger data…");
  const r=await fetch(url); if(!r.ok) throw new Error();
  const raw=await r.json();
  const chargers=raw.map(x=>({
   name:x.AddressInfo?.Title||"EV charger",lat:x.AddressInfo?.Latitude,lon:x.AddressInfo?.Longitude,
   address:[x.AddressInfo?.AddressLine1,x.AddressInfo?.Town].filter(Boolean).join(", "),
   power:Math.max(0,...(x.Connections||[]).map(c=>Number(c.PowerKW)||0)),
   status:x.StatusType?.IsOperational===false?"Unavailable":"Available",
   distance:Number(x.AddressInfo?.Distance||0).toFixed(1)
  })).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
  loadChargers(chargers,`${chargers.length} live chargers found.`);
 }catch{loadChargers(demoChargers,"Live lookup was unavailable, so demo chargers were loaded.");}
}
function loadChargers(items,msg){state.chargers=items;setStatus(msg);render()}
function render(){
 const min=Number($("powerFilter").value);const q=$("searchInput").value.trim().toLowerCase();
 const items=state.chargers.filter(c=>c.power>=min&&(!q||`${c.name} ${c.address}`.toLowerCase().includes(q)));
 state.markers.forEach(m=>m.remove());state.markers=[];
 $("chargerList").innerHTML="";
 items.forEach(c=>{
  const m=L.marker([c.lat,c.lon]).addTo(state.map).bindPopup(`<b>${esc(c.name)}</b><br>${esc(c.address)}<br>${c.power||"?"} kW`);
  state.markers.push(m);
  const el=document.createElement("article");el.className="charger";
  el.innerHTML=`<div class="charger-head"><div><h3>${esc(c.name)}</h3><p>${esc(c.address||"Address unavailable")}</p></div><span class="badge">${esc(c.status)}</span></div><div class="meta"><span>⚡ ${c.power||"?"} kW</span><span>📍 ${c.distance||"?"} km</span><span><a href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}" target="_blank" rel="noopener">Navigate</a></span></div>`;
  el.addEventListener("click",e=>{if(e.target.tagName!=="A"){state.map.setView([c.lat,c.lon],15);m.openPopup()}});
  $("chargerList").appendChild(el);
 });
 $("totalCount").textContent=items.length;
 $("availableCount").textContent=items.filter(c=>c.status==="Available").length;
 $("fastCount").textContent=items.filter(c=>c.power>=150).length;
 if(items.length&&state.markers.length){const g=L.featureGroup(state.markers);state.map.fitBounds(g.getBounds().pad(.15))}
}
function estimateTrip(){
 const d=$("destinationInput").value.trim();const b=Number($("batteryInput").value);const r=Number($("rangeInput").value);
 if(!d){$("tripResult").textContent="Please enter a destination.";return}
 const usable=Math.round(r*b/100);$("tripResult").innerHTML=`Current usable range: <strong>${usable} km</strong>.<br>Destination: <strong>${esc(d)}</strong>.<br><span class="muted">For turn-by-turn routing, connect a routing API in the next development stage.</span>`;
}
function setStatus(t){$("status").textContent=t}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
document.addEventListener("DOMContentLoaded",init);
