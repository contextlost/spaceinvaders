(()=>{
  /* 1) Canvas & UI refs */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha:false });
  ctx.imageSmoothingEnabled = false;
  const WIDTH = canvas.width, HEIGHT = canvas.height;

  const BG = ctx.createLinearGradient(0,0,0,HEIGHT);
  BG.addColorStop(0,'#020a14');
  BG.addColorStop(1,'#020a14');

  const overlayEl = document.getElementById('overlay');
  const transmissionOverlayEl = document.getElementById('transmission-overlay');
  const transmissionTextEl = document.getElementById('transmission-text');
  const closeTransmissionBtn = document.getElementById('close-transmission-btn');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  const hiEl = document.getElementById('hiscore');
  const toastEl = document.getElementById('toast');

  /* 2) Game state & constants */
  const STATE = { MENU:0, PLAY:1, PAUSE:2, GAMEOVER:3, LEVELCLEAR:4, TRANSMISSION:5, BOSS:6 };
  let state = STATE.MENU;
  let score=0, hiScore=Number(localStorage.getItem('si_hiscore')||0), level=1, lives=3, muted=false;

  let fireMode = 'center';
  const PLAYER = { w:30,h:28,y:HEIGHT-62,speed:340,cooldown:0,fireDelay:320 };
  let player = { x:WIDTH/2,y:PLAYER.y,w:PLAYER.w,h:PLAYER.h,hitTimer:0 };
  /* === Embedded Spaceship PNG (data URI) + helpers === */
  const SHIP_TARGET_HEIGHT = 60;   // adjust size here
  const SHIP_Y_OFFSET = 12;   // positive = move ship DOWN (pixels)
  let shipReady = false, shipSprite = null, shipW = 0, shipH = 0;

  const shipImg = new Image();
  shipImg.src = "ship.png";
  shipImg.onload = () => {
    // 1) Draw original into offscreen
    const off = document.createElement('canvas');
    off.width = shipImg.width; off.height = shipImg.height;
    const ictx = off.getContext('2d', { willReadFrequently: true });
    ictx.imageSmoothingEnabled = false;
    ictx.drawImage(shipImg, 0, 0);

    // 2) Remove navy background by edge-color similarity
    const id = ictx.getImageData(0, 0, off.width, off.height);
    const data = id.data, w = off.width, h = off.height;
    let sr=0, sg=0, sb=0, n=0;
    const stepX = Math.max(1, Math.floor(w/64));
    const stepY = Math.max(1, Math.floor(h/64));
    for (let x=0; x<w; x+=stepX) {
      let i1=(0*w+x)*4, i2=((h-1)*w+x)*4;
      sr+=data[i1]; sg+=data[i1+1]; sb+=data[i1+2]; n++;
      sr+=data[i2]; sg+=data[i2+1]; sb+=data[i2+2]; n++;
    }
    for (let y=0; y<h; y+=stepY) {
      let i1=(y*w+0)*4, i2=(y*w+(w-1))*4;
      sr+=data[i1]; sg+=data[i1+1]; sb+=data[i1+2]; n++;
      sr+=data[i2]; sg+=data[i2+1]; sb+=data[i2+2]; n++;
    }
    const br = sr/n, bg = sg/n, bb = sb/n;
    const thr2 = 28*28;
    for (let i=0; i<data.length; i+=4) {
      const dr=data[i]-br, dg=data[i+1]-bg, db=data[i+2]-bb;
      if (dr*dr + dg*dg + db*db <= thr2) data[i+3]=0;
    }
    ictx.putImageData(id,0,0);

    // 3) Pre-scale for crisp pixels and speed
    shipH = SHIP_TARGET_HEIGHT;
    shipW = Math.max(1, Math.round(off.width * (shipH / off.height)));
    shipSprite = document.createElement('canvas');
    shipSprite.width = shipW; shipSprite.height = shipH;
    const sctx = shipSprite.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(off, 0, 0, shipW, shipH);

    // 4) Update hitbox to better fit the PNG
    player.w = Math.round(shipW * 0.68);
    player.h = Math.round(shipH * 0.75);

    shipReady = true;
  };

  // Bullet spawn helper
  function shipTopY(){ return player.y - (shipReady ? shipH : player.h) + SHIP_Y_OFFSET; }

  // Booster geometry (normalized to sprite size based on your PNG)
  const FLAME_TOP_N    = 0.780041;
  const FLAME_HEIGHT_N = 0.146640;
  const FLAME_WIDTH_N  = 0.099352;

  function drawShipFlame(px, py) {
    if (!shipReady) return;
    const t = performance.now() * 0.001;
    const cx = px + shipW * 0.5;
    const yTop = py + shipH * FLAME_TOP_N + 1;
    const baseH = shipH * FLAME_HEIGHT_N;
    const baseW = shipW * FLAME_WIDTH_N;

    const wiggle = 0.30 + 0.25*Math.sin(t*17.0) + 0.25*Math.sin(t*41.0);
    const height = baseH * (0.9 + 1.1*wiggle);
    const wTop   = baseW * (0.55 + 0.20*Math.sin(t*23.0));
    const wBot   = baseW * (0.18 + 0.10*Math.cos(t*29.0));
    const yBot   = yTop + height;

    const g = ctx.createLinearGradient(cx, yTop, cx, yBot);
    g.addColorStop(0.00, 'rgba(255,255,210,0.95)');
    g.addColorStop(0.35, 'rgba(255,200, 64,0.95)');
    g.addColorStop(0.70, 'rgba(255,140, 40,0.90)');
    g.addColorStop(1.00, 'rgba(255, 90, 20,0.00)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - wTop, yTop);
    ctx.lineTo(cx + wTop, yTop);
    ctx.lineTo(cx + wBot, yBot);
    ctx.lineTo(cx - wBot, yBot);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.7;
    ctx.fillStyle = 'rgba(255,220,80,0.7)';
    for (let i = 0; i < 3; i++) {
      const yy = yTop + height*(0.25 + 0.22*i) + Math.sin(t*60 + i)*1.0;
      const w  = baseW*(0.35 + 0.25*Math.sin(t*45 + i));
      ctx.fillRect(Math.round(cx - w/2), Math.round(yy), Math.round(w), 1);
    }
    ctx.restore();
  }

  const BULLETS = { speed:560,w:4,h:10,trailLength: 6 };
  const ENEMY_BULLETS = { speed:240,w:4,h:12 };
  let pBullets=[], eBullets=[];

  const UFO_SCALE = 3;
  const UFO_MASK = [
      "000000111111000000", "000012111111120000", "001211111111112100",
      "111111111111111111", "001211111111112100", "000011001100110000"
  ];
  const UFO_PALETTE = { '1': '#47a3ff', '2': '#d4ebff' };
  let ufo=null;
  let ufoTimer=0; let ufoNext=randRange(10,22);

  const GRID = { rows:5, cols:11, hgap:16, vgap:14, startX:80, startY:84 };
  let invaders=[];
  let invDir=1, invSpeed=18;
  const invStepDown = 24;
  let shootTimer=0, shootEvery=1100;
  let marchTimer=0, marchInterval=640, marchPhase=0;
  let anim={t:0};

  let bricks=[];
  const stars=new Array(90).fill(0).map(()=>({x:Math.random()*WIDTH,y:Math.random()*HEIGHT,s:Math.random()*2+0.5,spd:8+Math.random()*12}));

  const storyMessages = [
      "", // Level 1
      "Transmission 1: 'The first wave has fallen. They seem to be drones, mindlessly following a pre-programmed attack pattern. We must analyze this data.'", // Level 2
      "Transmission 2: 'Our analysis is complete. The drones are clearing the way for a single, powerful entity. We're picking up a massive energy signature. Prepare for contact.'", // Level 3
      "Transmission 3: 'Its sheer size is overwhelming. It's a living weapon, a bio-construct designed for total annihilation. There is no escape.'", // Level 4
      "Transmission 4: 'The core resonance is... unstable. Your resistance is corrupting our signal, introducing chaotic variables into our harvest protocols! The Prime Collector is not pleased!'", // Level 5
      "Transmission 5: 'This is not just a battle, it is a statement. Your defiance, your chaotic energy, it has created a ripple effect through the Collector's network. Your world is un-purifiable.'", // Level 6
      "Transmission 6: 'Further analysis shows their technology is adaptive. Each wave is stronger than the last. We must hold the line.'", // Level 7
      "Transmission 7: 'We've identified a weakness in their command structure. The signal originates from a single, massive vessel. It's coming.'", // Level 8
      "Transmission 8: 'Their fleet is endless. For every ship we destroy, two more take its place. This is a war of attrition.'", // Level 9
      "Transmission 9: 'The command vessel is on an intercept course. All previous transmissions were a distraction. Prepare for the final battle!'", // Level 10
  ];
  
  let bossContainer = null;
  let bossBricks = [];
  let initialBossBrickCount = 0;
  const BOSS_PIXEL_SCALE = 5;

  const BOSS_MASK = [
      "0000444444440000",
      "0041111111114400",
      "0411111111111140",
      "4112211112211114",
      "4123211112321114",
      "4111111111111114",
      "041113333111140",
      "004111111111400",
      "000444444444000"
  ];
  const BOSS_PALETTE = { '1': '#ff1744', '2': '#ff5252', '3': '#c5001a', '4': '#000000' };
  let bossTarget = null;
  const BOSS_MOVEMENT_SPEED = 120;
  const BOSS_FIRE_RATE = 2.5;

  /* 3) Input (keyboard) */
  const keys = new Set();
  addEventListener('keydown',e=>{
    const k=e.key.toLowerCase();
    if(['arrowleft','arrowright',' ','enter','p','r','m','a','d','1','2','escape'].includes(k)) e.preventDefault();
    keys.add(k);
    
    if(k==='enter' && (state === STATE.MENU || state === STATE.LEVELCLEAR || state === STATE.TRANSMISSION)){
      if (state === STATE.TRANSMISSION) {
        hideTransmissionOverlay();
      } else {
        startGame();
      }
    } else if (k === 'enter' && state === STATE.GAMEOVER){
      startGame(true);
    }

    if(k==='p'&&state===STATE.PLAY){ state=STATE.PAUSE; showOverlay('Paused'); }
    else if(k==='p'&&state===STATE.PAUSE){ hideOverlay(); state=STATE.PLAY; }
    if(k==='r'){ startGame(true); }
    if(k==='m'){ muted=!muted; flashHUD(`Sound ${muted?'off':'on'}`); }
    if(k==='1'){ fireMode='center'; flashHUD('Fire: Center'); }
    if(k==='2'){ fireMode='dual';   flashHUD('Fire: Dual'); }
    if(k==='escape'){ toMainMenu(); }
  });
  addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('pointerdown',()=>canvas.focus());

  closeTransmissionBtn.addEventListener('click', () => {
      hideTransmissionOverlay();
  });

  /* 4) Audio helpers */
  const audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  function beep({freq=440,dur=0.08,type='square',vol=0.1}){
    if(muted) return; const t0=audioCtx.currentTime;
    const o=audioCtx.createOscillator(); const g=audioCtx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t0);
    g.gain.setValueAtTime(vol,t0); g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0+dur);
  }
  function explosion(){
    if(muted) return; const dur=0.4; const t0=audioCtx.currentTime;
    const buffer=audioCtx.createBuffer(1, audioCtx.sampleRate*dur, audioCtx.sampleRate);
    const data=buffer.getChannelData(0); for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
    const src=audioCtx.createBufferSource(); src.buffer=buffer;
    const g=audioCtx.createGain(); const lp=audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=3000;
    src.connect(lp).connect(g).connect(audioCtx.destination); src.start(t0);
  }
  function playerHitSound(){
    if(muted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.connect(gain).connect(audioCtx.destination);
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(100, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.2);
  }
  function bonk(){ beep({freq:150, dur:.08, vol:.2, type:'triangle'}); }
  function playMarch(){ const tones=[260,230,205,180]; beep({freq:tones[marchPhase%4],dur:.06,type:'square',vol:.12}); marchPhase++; }
  function levelClearSound(){
    if(muted) return;
    beep({freq: 440, dur: 0.1, vol: 0.2});
    setTimeout(() => beep({freq: 550, dur: 0.1, vol: 0.2}), 100);
    setTimeout(() => beep({freq: 660, dur: 0.1, vol: 0.2}), 200);
  }
  function gameOverSound(){
    if(muted) return;
    beep({freq: 300, dur: 0.3, vol: 0.4});
    setTimeout(() => beep({freq: 200, dur: 0.3, vol: 0.4}), 300);
  }
  function bossHitSound() {
    if(muted) return;
    beep({freq: 200, dur: 0.05, vol: 0.2, type: 'triangle'});
  }

  /* 5) Entities & drawing */
  const SHIP_MASK=[
    "000000010000000", "000000111000000", "000001111100000", "000011111110000",
    "000111000111000", "000111000111000", "000111000111000", "010011111110010",
    "010011111110010", "010001111100010", "000001111100000", "000000111000000",
    "000000010000000", "000000010000000"
  ];
  const SHIP_SCALE=2;
  const maskRows=SHIP_MASK.length, maskCols=SHIP_MASK[0].length;

  function drawPlayer(){

  if (shipReady && shipSprite) {
    const px = Math.round(player.x - shipW / 2);
    const py = Math.round(player.y - shipH + SHIP_Y_OFFSET);
    ctx.drawImage(shipSprite, px, py);
    drawShipFlame(px, py);
    return;
  }
  // Fallback: do nothing until image is ready (loads instantly from data URI)
  // (Old pixel ship drawing removed intentionally)

}

  const BUGS = {
    0:[["00011110000","00111111000","01101101100","11111111110","11111111110","00111111000","00011011000","00100100100"],["00011110000","00111111000","01101101100","11111111110","11111111110","00111111000","00100100100","00011011000"]],
    1:[["000011110000","001111111100","011101110110","111111111111","001111111100","000110011000","001100001100","110000000011"],["000011110000","001111111100","011101110110","111111111111","001111111100","011000001100","000110011000","001100001100"]],
    2:[["000110011000","001111111100","011011110110","110111011011","111111111111","001101101100","011000001100","110000000011"],["000110011000","001111111100","011011110110","110111011011","111111111111","011001100110","001100001100","110000000011"]],
    3:[["001111111100","011111111110","110110110011","111111111111","011111111110","001101101100","011000001100","110000000011"],["001111111100","011111111110","110110110011","111111111111","011111111110","011000001100","001101101100","110000000011"]],
    4:[["000110011000","001111111100","111111111111","111011110111","011101110110","001111111100","000110011000","000110011000"],["000110011000","001111111100","111111111111","111011110111","011101110110","001111111100","000110011000","001001100100"]]
  };
  function drawBug(ctx, x, y, type, color, scale = 2) {
      const animValue = Math.floor(anim.t*6);
      const frame = (animValue % 2 + 2) % 2;
      const bugPattern = BUGS[type]?.[frame];
      if (!bugPattern) return;
      drawPattern(ctx, x, y, bugPattern, scale, color || '#8cff66');
  }

  function drawUFO(){
    if(!ufo) return;
    drawPatternColor(ctx, ufo.x, ufo.y, UFO_MASK, UFO_SCALE, UFO_PALETTE);
  }

  function buildShields(){
    bricks.length=0; const shieldCount=4; const shieldW=80; const startX=90;
    const gap=(WIDTH-startX*2-shieldCount*shieldW)/(shieldCount-1);
    for(let i=0;i<shieldCount;i++){
      const ox=startX + i*(shieldW+gap); const oy=HEIGHT-160; const bw=8,bh=8;
      for(let r=0;r<6;r++) for(let c=0;c<10;c++){
        if((r<=1 && (c<2||c>7)) || (r===0 && (c<3||c>6))) continue;
        bricks.push({x:ox+c*bw,y:oy+r*bh,w:bw-1,h:bh-1});
      }
    }
  }

  function initBoss(){
    const bossW = BOSS_MASK[0].length * BOSS_PIXEL_SCALE;
    const bossH = BOSS_MASK.length * BOSS_PIXEL_SCALE;

    bossContainer = {
      x: WIDTH / 2 - bossW / 2, y: 120, w: bossW, h: bossH,
      vx: 0, vy: 0, fireTimer: 0
    };

    bossBricks = [];
    for(let r=0; r < BOSS_MASK.length; r++){
      for(let c=0; c < BOSS_MASK[0].length; c++){
        const char = BOSS_MASK[r][c];
        if(char !== '0'){
          bossBricks.push({
            x: c * BOSS_PIXEL_SCALE,
            y: r * BOSS_PIXEL_SCALE,
            w: BOSS_PIXEL_SCALE,
            h: BOSS_PIXEL_SCALE,
            color: BOSS_PALETTE[char]
          });
        }
      }
    }
    initialBossBrickCount = bossBricks.length;

    state = STATE.BOSS;
    setNewBossTarget();
  }

  function drawBoss(){
    if (!bossContainer) return;
    for(const brick of bossBricks){
      ctx.fillStyle = brick.color;
      ctx.fillRect(bossContainer.x + brick.x, bossContainer.y + brick.y, brick.w, brick.h);
    }
  }

  function buildInvaders(){
    invaders.length = 0;
    const palette = ['#8cff66','#b7ff4f','#6df7e6','#ff72e1','#ffe66b'];
    for(let r=0;r<GRID.rows;r++){
      for(let c=0;c<GRID.cols;c++){
        const x = GRID.startX + c*(26 + GRID.hgap);
        const y = GRID.startY + r*(18 + GRID.vgap);
        const type = r % 5;
        const color = palette[(r+c)%palette.length];
        invaders.push({ x, y, w:24, h:16, row:r, col:c, type, alive:true, color });
      }
    }
    invDir = 1;
    invSpeed = 18 + (level-1)*8;
    shootEvery = Math.max(320, 1100 - (level-1)*110);
    updateMarchInterval();
  }

  function drawFireBlast(bullet) {
      for (let i = 0; i < bullet.trail.length; i++) {
          const pos = bullet.trail[i];
          const size = (i + 1) / bullet.trail.length * 4;
          const alpha = (i + 1) / bullet.trail.length * 0.5;
          const color = `rgba(255, 150, 0, ${alpha})`;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, size, 0, 2 * Math.PI);
          ctx.fill();
      }

      const gradient = ctx.createRadialGradient(bullet.x, bullet.y, 1, bullet.x, bullet.y, 6);
      gradient.addColorStop(0, 'rgba(255, 255, 150, 1)');
      gradient.addColorStop(0.5, 'rgba(255, 100, 0, 1)');
      gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 6, 0, 2 * Math.PI);
      ctx.fill();
  }

  function drawEnemyBullet(bullet) {
      ctx.fillStyle = '#4cc9f0';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 4, 0, 2 * Math.PI);
      ctx.fill();

      const glowRadius = 8 + Math.sin(anim.t * 10) * 2;
      const glowAlpha = 0.4 + Math.sin(anim.t * 10) * 0.2;
      const glowGradient = ctx.createRadialGradient(bullet.x, bullet.y, 1, bullet.x, bullet.y, glowRadius);
      glowGradient.addColorStop(0, `rgba(76, 201, 240, ${glowAlpha})`);
      glowGradient.addColorStop(1, `rgba(76, 201, 240, 0)`);
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, glowRadius, 0, 2 * Math.PI);
      ctx.fill();
  }

  /* 6) Helpers (collision, math, pattern rendering) */
  function rect(a,b){return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y}
  function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v))}
  function randRange(a,b){return a+Math.random()*(b-a)}
  function drawPattern(ctx, x, y, pat, scale, color){ ctx.fillStyle=color; const px=x|0, py=y|0; for(let r=0;r<pat.length;r++){ const row=pat[r]; for(let c=0;c<row.length;c++){ if(row[c]==='1') ctx.fillRect(px+c*scale, py+r*scale, scale, scale); }}}
  function drawPatternColor(ctx, x, y, pat, scale, palette){ const px=x|0, py=y|0; for(let r=0;r<pat.length;r++){ const row=pat[r]; for(let c=0;c<row.length;c++){ const ch=row[c]; if(ch==='0') continue; ctx.fillStyle=palette[ch]||'#fff'; ctx.fillRect(px+c*scale, py+r*scale, scale, scale); }}}

  function bottomMostByCol(){ const map=new Map(); for(const iv of invaders){ if(!iv.alive) continue; const prev=map.get(iv.col); if(!prev||iv.y>prev.y) map.set(iv.col,iv);} return [...map.values()]; }

  function updateHUD(){
    const safeLives = Math.max(0, Math.floor(lives||0));
    scoreEl.textContent = String(score);
    livesEl.textContent = '♥'.repeat(safeLives);
    levelEl.textContent = String(level);
    hiEl.textContent = String(hiScore);
  }

  function flashHUD(txt){
    toastEl.textContent = txt; toastEl.style.opacity = '1';
    clearTimeout(toastEl._hideT); toastEl._hideT = setTimeout(()=>{ toastEl.style.opacity = '0'; }, 1100);
  }

  function showOverlay(html, kind){
    const card = overlayEl.querySelector('.card');
    const actionText = kind === 'gameover' ? 'restart' : 'continue';
    card.className = 'card';
    if(kind==='levelclear' || kind === 'gameover') card.classList.add('levelclear');
    card.innerHTML = `<h1>${html}</h1><p>Press <span class='kbd'>Enter</span> to ${actionText}</p>`;
    overlayEl.classList.remove('hidden');
  }
  function hideOverlay(){ overlayEl.classList.add('hidden'); }

  function showMainMenu(){
    const card = overlayEl.querySelector('.card');
    card.classList.add('menu');
    card.innerHTML = `<h1>Space Invaders</h1>
      <p>← / → move · Space shoot · <span class="kbd">1</span> center fire · <span class="kbd">2</span> dual fire</p>
      <p class="control-line"><span class="kbd">P</span> pause · <span class="kbd">R</span> restart · <span class="kbd">M</span> mute · <span class="kbd">Esc</span> menu</p>
      <p><strong>Press <span class="kbd">Enter</span> to start</strong></p>`;
    overlayEl.classList.remove('hidden');
  }

  function showTransmissionOverlay(message) {
      state = STATE.TRANSMISSION;
      transmissionTextEl.textContent = message;
      transmissionOverlayEl.classList.remove('hidden');
  }

  function hideTransmissionOverlay() {
      transmissionOverlayEl.classList.add('hidden');
      last = performance.now();
      level++;
      startGame();
  }

  /* 7) Game flow (start/menu/level/game over) */
  function updateMarchInterval(){ const alive=invaders.reduce((n,v)=>n+(v.alive?1:0),0); marchInterval=Math.max(140,640-(GRID.rows*GRID.cols-alive)*9); }

  function startGame(fullRestart = false){
    if(fullRestart) {
      score = 0;
      lives = 3;
      level = 1;
    }
    state=STATE.PLAY; hideOverlay();
    player.x=WIDTH/2; player.y=PLAYER.y; player.hitTimer=0;
    pBullets=[]; eBullets=[]; PLAYER.cooldown=0;

    if (level === 10) {
      initBoss();
      buildShields();
      ufo = null;
      invaders = [];
    } else {
      buildInvaders();
      buildShields();
    }
    ufo=null; ufoTimer=0; ufoNext=randRange(12,24);
    updateHUD(); last=performance.now();
    anim.t = 0;
  }

  function nextLevel(){
      levelClearSound();
      if (level >= 10) {
          level++;
          startGame();
          return;
      }
      const storyIndex = level;
      let message = storyMessages[storyIndex] || "Victory! The invaders are retreating, for now.";
      showTransmissionOverlay(message);
  }

  function gameOver(){
    state=STATE.GAMEOVER;
    hiScore=Math.max(hiScore,score);
    localStorage.setItem('si_hiscore',hiScore);
    gameOverSound();
    showOverlay(`Game Over — Score ${score}`, 'gameover');
  }
  function toMainMenu(){
    state = STATE.MENU;
    pBullets = []; eBullets = []; invaders = []; bricks = []; ufo = null; ufoTimer = 0; player.hitTimer = 0; PLAYER.cooldown = 0;
    score = 0; lives = 3; level = 1; updateHUD(); showMainMenu();
    anim.t = 0;
  }

  /* 8) Update & Render loop */
  let last=performance.now();
  function loop(now){
    const dt=Math.min(50,now-last)/1000; last=now;
    ctx.fillStyle=BG; ctx.fillRect(0,0,WIDTH,HEIGHT);
    ctx.fillStyle='#0b1b2a'; for(const st of stars){ st.y+=st.spd*dt; if(st.y>HEIGHT) st.y=-2; ctx.fillRect(st.x,st.y,st.s,st.s); }

    if(state===STATE.PLAY || state===STATE.BOSS){ update(dt); }
    render();
    requestAnimationFrame(loop);
  }

  function setNewBossTarget() {
      bossTarget = {
          x: randRange(20, WIDTH - bossContainer.w - 20),
          y: randRange(20, HEIGHT * 0.5)
      };
  }

  function update(dt){
    anim.t+=dt;
    const left=keys.has('arrowleft')||keys.has('a'); const right=keys.has('arrowright')||keys.has('d');
    let vx=(right?1:0)-(left?1:0); player.x=clamp(player.x+vx*PLAYER.speed*dt,20,WIDTH-20);

    if(PLAYER.cooldown>0) PLAYER.cooldown-=dt*1000;
    if((keys.has(' ')||keys.has('space'))&&PLAYER.cooldown<=0){
      if(fireMode==='dual'){
        const leftX  = (player.x - Math.floor(player.w/2)) + Math.floor(player.w*0.32);
        const rightX = (player.x - Math.floor(player.w/2)) + Math.floor(player.w*0.68);
        pBullets.push({x:leftX, y: shipTopY()-8, w:BULLETS.w,h:BULLETS.h,vy:-BULLETS.speed, trail: []});
        pBullets.push({x:rightX,y: shipTopY()-8, w:BULLETS.w,h:BULLETS.h,vy:-BULLETS.speed, trail: []});
      }else{
        pBullets.push({x:player.x, y: shipTopY()-8, w:BULLETS.w,h:BULLETS.h,vy:-BULLETS.speed, trail: []});
      }
      PLAYER.cooldown=Math.max(90,PLAYER.fireDelay-(level-1)*18); beep({freq:980,type:'square',dur:.05,vol:.12});
    }

    for(const b of pBullets) {
      b.trail.push({x: b.x, y: b.y});
      if (b.trail.length > BULLETS.trailLength) {
          b.trail.shift();
      }
      b.y += b.vy * dt;
    }

    for(const b of eBullets) b.y+=b.vy*dt;
    pBullets=pBullets.filter(b=>b.y+b.h>0); eBullets=eBullets.filter(b=>b.y<HEIGHT+20);

    for (const b of pBullets) {
      for (let i = bricks.length - 1; i >= 0; i--) {
          const br = bricks[i];
          if (rect(b, br)) {
              bricks.splice(i, 1);
              b.y = -9999;
              bonk();
              break;
          }
      }
    }

    if (state === STATE.BOSS) {
      const dx = bossTarget.x - bossContainer.x;
      const dy = bossTarget.y - bossContainer.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 10) {
          setNewBossTarget();
      } else {
          bossContainer.x += (dx / dist) * BOSS_MOVEMENT_SPEED * dt;
          bossContainer.y += (dy / dist) * BOSS_MOVEMENT_SPEED * dt;
      }

      bossContainer.fireTimer += dt;
      if (bossContainer.fireTimer >= BOSS_FIRE_RATE) {
          const numBullets = 5;
          for (let i = 0; i < numBullets; i++) {
              const angle = (Math.PI / 4) + (i * (Math.PI / 2) / (numBullets - 1));
              const bulletVx = Math.cos(angle) * ENEMY_BULLETS.speed;
              const bulletVy = Math.sin(angle) * ENEMY_BULLETS.speed;
              eBullets.push({
                  x: bossContainer.x + bossContainer.w / 2,
                  y: bossContainer.y + bossContainer.h,
                  w: ENEMY_BULLETS.w,
                  h: ENEMY_BULLETS.h,
                  vy: bulletVy,
                  vx: bulletVx
              });
          }
          bossContainer.fireTimer = 0;
          beep({freq:300,type:'sawtooth',dur:.06,vol:.08});
      }

      for (const b of pBullets) {
          for (let i = bossBricks.length - 1; i >= 0; i--) {
              const brick = bossBricks[i];
              const brickAbs = {
                  x: bossContainer.x + brick.x,
                  y: bossContainer.y + brick.y,
                  w: brick.w,
                  h: brick.h
              };
              if (rect(b, brickAbs)) {
                  bossBricks.splice(i, 1);
                  b.y = -9999;
                  bossHitSound();
                  break;
              }
          }
      }

      if (bossBricks.length <= initialBossBrickCount / 2) {
          score += 1000;
          explosion();
          nextLevel();
      }


    } else {
      ufoTimer+=dt;
      if(!ufo && ufoTimer>=ufoNext){
        ufoTimer=0;
        ufoNext=randRange(12,24);
        const fromLeft=Math.random()<0.5;
        const ufoW = UFO_MASK[0].length * UFO_SCALE;
        const ufoH = UFO_MASK.length * UFO_SCALE;
        ufo={
          x: fromLeft?-ufoW-20:WIDTH+20,
          y: 80,
          w: ufoW,
          h: ufoH,
          vx: fromLeft? 110: -110,
          points: (50+Math.floor(Math.random()*6)*50)
        };
        beep({freq:600,type:'triangle',dur:.2,vol:.15});
      }
      if(ufo){ ufo.x+=ufo.vx*dt; if(ufo.x<-UFO_MASK[0].length * UFO_SCALE - 20 || ufo.x>WIDTH+20) ufo=null; }

      let minX=Infinity,maxX=-Infinity,maxY=-Infinity,aliveCount=0;
      for(const iv of invaders){ if(!iv.alive) continue; aliveCount++; minX=Math.min(minX,iv.x); maxX=Math.max(maxX,iv.x+iv.w); maxY=Math.max(maxY,iv.y+iv.h); }
      if(aliveCount===0){ nextLevel(); return; }

      const speed=invSpeed+((GRID.rows*GRID.cols-aliveCount)*1.2); const dx=invDir*speed*dt; let edgeHit=false;
      for(const iv of invaders){ if(!iv.alive) continue; iv.x+=dx; }
      if(minX+dx<12 || maxX+dx>WIDTH-12) edgeHit=true;
      if(edgeHit){ invDir*=-1; for(const iv of invaders){ if(!iv.alive) continue; iv.y+=invStepDown; } playMarch(); }
      if(maxY>=HEIGHT-80){ lives=0; updateHUD(); gameOver(); return; }

      shootTimer+=dt*1000; const cadence=Math.max(150,shootEvery-(GRID.rows*GRID.cols-aliveCount)*10);
      marchTimer+=dt*1000; if(marchTimer>=Math.max(120,marchInterval-(GRID.rows*GRID.cols-aliveCount)*8)){ marchTimer=0; playMarch(); }
      if(shootTimer>=cadence){ shootTimer=0; const shooters=bottomMostByCol(); if(shooters.length){ const pick = shooters[(Math.random()*shooters.length)|0]; eBullets.push({x:pick.x+pick.w/2-2,y:pick.y+pick.h+2,w:ENEMY_BULLETS.w,h:ENEMY_BULLETS.h,vy:ENEMY_BULLETS.speed}); beep({freq:200,type:'sawtooth',dur:.06,vol:.08}); } }

      for(const b of pBullets){
        for(const iv of invaders){ if(!iv.alive) continue; if(rect(b,iv)){ iv.alive=false; b.y=-9999; const rowPts = 10 + iv.row*5; score += rowPts; updateHUD(); updateMarchInterval(); beep({freq:1200, dur:.05, vol:.1}); } }
        if(ufo && rect(b,ufo)){
          score += ufo.points;
          flashHUD(`UFO +${ufo.points}`);
          updateHUD();
          explosion();
          ufo=null;
          b.y=-9999;
        }
      }
    }

    for(const b of eBullets){
      const playerRect = { x: player.x - player.w / 2, y: player.y, w: player.w, h: player.h };
      if(player.hitTimer<=0 && rect(b,playerRect)){
        b.y=9999; lives = Math.max(0, lives - 1); updateHUD(); playerHitSound(); player.hitTimer=.8;
        if(lives<=0){ gameOver(); return; }
      }
      for(let i=bricks.length - 1; i >= 0; i--){ const br=bricks[i]; if(rect(b,br)){ bricks.splice(i,1); b.y=9999; bonk(); break; } }
    }
    eBullets=eBullets.filter(b=>{ return b.y < HEIGHT + 20; });

    if(player.hitTimer){ player.hitTimer-=dt; if(player.hitTimer<0) player.hitTimer=0; }

    for(const pb of pBullets){ for(const eb of eBullets){ if(rect(pb,eb)){ pb.y=-9999; eb.y=9999; beep({freq:300,dur:.04,vol:.1}); score+=5; updateHUD(); } } }

    pBullets=pBullets.filter(b=>b.y>-40);
  }

  function render(){
    ctx.fillStyle='#42ff85'; for(const br of bricks){ ctx.fillRect(br.x,br.y,br.w,br.h); }
    drawUFO();
    if (state === STATE.BOSS) {
        drawBoss();
    } else {
        for(const iv of invaders){ if(!iv.alive) continue; drawBug(ctx, iv.x, iv.y, iv.type, iv.color); }
    }
    if(!player.hitTimer || Math.floor(player.hitTimer*10)%2===0) drawPlayer();
    for(const b of pBullets) drawFireBlast(b);
    for(const b of eBullets) drawEnemyBullet(b);
  }

  (function start(){ updateHUD(); showMainMenu(); requestAnimationFrame(loop); })();
})();