"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const REPORT_URL = "#atlas-record";

const stages = [
  "Submitted at dealer",
  "Picked up, ATLAS courier",
  "At ATLAS facility",
  "Graded, certified",
  "Sealed, en route",
  "Ready for pickup",
];

const cardProfiles = {
  sports: {
    id: "sports",
    name: "Kobe Bryant",
    label: "1996 TOPPS · #138",
    series: "KOBE BRYANT ROOKIE",
    number: "138",
    grade: "9.5",
    image: "/marketing/atlas-kobe-rookie.jpg",
    imageAlt: "Raw 1996 Topps Kobe Bryant rookie card",
    defectA: "EDGE WHITENING · 0.45 MM",
    defectB: "CENTERING · 51.2 / 48.8",
  },
  pokemon: {
    id: "pokemon",
    name: "Charizard",
    label: "1999 POKÉMON · #4",
    series: "1ST EDITION CHARIZARD",
    number: "4",
    grade: "9.5",
    image: "/marketing/atlas-charizard-first-edition.jpg",
    imageAlt: "Raw 1999 First Edition Charizard Pokémon card",
    defectA: "CORNER WEAR · 0.32 MM",
    defectB: "SURFACE PRINT · 3.05 MM",
  },
  basketball: {
    id: "basketball",
    name: "Tom Brady",
    label: "2000 BOWMAN CHROME · #236",
    series: "TOM BRADY ROOKIE",
    number: "236",
    grade: "9.5",
    image: "/marketing/atlas-tom-brady-rookie.jpg",
    imageAlt: "Raw 2000 Bowman Chrome Tom Brady rookie card",
    defectA: "EDGE WHITENING · 0.27 MM",
    defectB: "CORNER RADIUS · 3.18 MM",
  },
};

const journeyMoments = [
  {
    time: "00:00",
    label: "DROP OFF",
    title: "Choose. Submit. Follow.",
    copy: "Choose dealer drop-off or mail-in. Your submission records the cards, intake method and confirmed return details.",
  },
  {
    time: "04:00",
    label: "WE PICK UP",
    title: "Your chosen route. Recorded.",
    copy: "Follow the confirmed instructions for your submission. The team records receipt when the physical cards arrive.",
  },
  {
    time: "12:00",
    label: "WE GRADE",
    title: "We measure. You see everything.",
    copy: "ATLAS finds every candidate defect. A human certifies what is real. The fingerprint, measurements and math become the grade.",
  },
  {
    time: "48:00",
    label: "WE RETURN",
    title: "Graded. Sealed. Returned.",
    copy: "The sealed, chipped slab returns with its living ATLAS report—every flaw, measurement and calculation ready to inspect.",
  },
];

const comparisonRows = [
  [
    "Grade comes from",
    "expert opinion by consensus",
    "a model’s output",
    "measurements, human-certified",
  ],
  ["Reasons shown", "no", "some annotations", "every flaw, pinned & magnified"],
  [
    "What each flaw cost you",
    "never shown",
    "never shown",
    "itemized, to the hundredth",
  ],
  [
    "Check the math yourself",
    "no math to check",
    "formula is private",
    "printed on every report",
  ],
  [
    "Same card, same grade twice",
    "not guaranteed — resubmission exists",
    "usually, until the model changes",
    "always — nothing to re-roll",
  ],
  [
    "Label verification",
    "sticker, hologram, QR",
    "QR code",
    "locked NFC chip + defect fingerprint",
  ],
  [
    "Door-to-door turnaround",
    "weeks to months",
    "weeks",
    "Confirmed for your submission",
  ],
  [
    "How your card travels",
    "you mail it and hope",
    "you mail it and hope",
    "dealer drop-off or mail-in",
  ],
];

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function AtlasGlyph({ small = false }) {
  return (
    <svg
      className={small ? "atlas-glyph atlas-glyph--small" : "atlas-glyph"}
      viewBox="0 0 64 48"
      aria-hidden="true"
    >
      <path d="M7 41 32 6l25 35" />
      <path d="M2 43.5C17 40 47 40 62 43.5" />
    </svg>
  );
}

function Wordmark() {
  return (
    <a className="wordmark" href="#top" aria-label="ATLAS — back to top">
      <AtlasGlyph small />
      <span>ATLAS</span>
      <small>KNOW WHAT YOU HAVE</small>
    </a>
  );
}

function SectionIntro({ number, label, title, children, id }) {
  return (
    <div className="section-intro" id={id}>
      <p className="section-code">
        <span>{number}</span>
        {label}
      </p>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function AtlasProofRibbon() {
  const proofs = [
    ["01", "MEASURED", "Every flaw quantified"],
    ["02", "MAPPED", "Every defect pinned"],
    ["03", "HUMAN CERTIFIED", "Every finding verified"],
    ["04", "NFC VERIFIED", "Every identity locked"],
  ];

  return (
    <section className="atlas-proof-ribbon" aria-label="The ATLAS proof standard">
      <div className="atlas-proof-ribbon__statement">
        <span>THE ATLAS STANDARD</span>
        <strong>THE GRADE<br />YOU CAN PROVE.</strong>
      </div>
      <div className="atlas-proof-ribbon__items">
        {proofs.map(([number, title, detail]) => (
          <div className="atlas-proof-ribbon__item" key={title}>
            <i aria-hidden="true">{number}</i>
            <span><b>{title}</b><small>{detail}</small></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function JourneyHUD({ time, stageIndex, progress }) {
  return (
    <aside className="journey-hud" aria-label="Illustrative grading journey">
      <div
        className="hud-dial"
        style={{ "--hud-progress": `${progress * 360}deg` }}
        aria-hidden="true"
      >
        <div className="hud-atlas-mark">
          <AtlasGlyph small />
        </div>
      </div>
      <div className="hud-copy">
        <span className="hud-time">{time}</span>
        <span className="hud-stage">{stages[stageIndex]}</span>
      </div>
      <ol className="hud-stages">
        {stages.map((stage, index) => (
          <li key={stage} className={index <= stageIndex ? "is-active" : ""}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {stage}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function ReceiptRail({ active }) {
  const items = ["Centering", "Corners", "Edges", "Surface"];
  return (
    <div className={`receipt-rail ${active ? "is-totaled" : ""}`} aria-hidden="true">
      <span className="receipt-title">GRADE RECEIPT</span>
      {items.map((item, index) => (
        <span className="receipt-line" key={item}>
          {item}
          <b>{active ? ["8.27", "10.00", "9.70", "10.00"][index] : "—"}</b>
        </span>
      ))}
      <span className="receipt-total">
        TOTAL <b>{active ? "9.5" : "PENDING"}</b>
      </span>
    </div>
  );
}

function SpecimenCard({ profile, compact = false, showDefects = false }) {
  return (
    <div className={`demo-card demo-card--${profile.id} ${profile.image ? "demo-card--photographic" : ""} ${compact ? "is-compact" : ""}`} aria-hidden="true">
      {profile.image && (
        <>
          <img className="demo-card-image" src={profile.image} alt={profile.imageAlt} />
          <span className="demo-card-fingerprint" />
        </>
      )}
      <span className="demo-card-foil" />
      {!profile.image && (
        <>
          <span className="demo-card-top">{profile.label}</span>
          <span className="demo-card-series">{profile.series}</span>
          <span className="demo-card-number">{profile.number}</span>
          <span className="demo-card-subject" />
          <span className="demo-card-atlas"><AtlasGlyph small /> ATLAS SPECIMEN</span>
        </>
      )}
      {showDefects && (
        <>
          <span className="card-defect card-defect--a">
            <i />
            <b>01</b>
            <small>{profile.defectA}</small>
          </span>
          <span className="card-defect card-defect--b">
            <i />
            <b>02</b>
            <small>{profile.defectB}</small>
          </span>
        </>
      )}
    </div>
  );
}

const heroCardOrder = [
  [cardProfiles.pokemon, "charizard"],
  [cardProfiles.sports, "kobe"],
  [cardProfiles.basketball, "brady"],
];

function PrecisionDefectMap({ profile }) {
  return (
    <div className="precision-defect-map" aria-hidden="true">
      <span className="precision-ai-badge"><i /> ATLAS VISION · DEMO</span>
      <span className="precision-defect precision-defect--a">
        <i className="precision-reticle"><b /></i>
        <em />
        <span><b>01 · {profile.defectA.split(" · ")[0]}</b><small>{profile.defectA.split(" · ")[1]} · CONF 99.8%</small><i /></span>
      </span>
      <span className="precision-defect precision-defect--b">
        <i className="precision-reticle"><b /></i>
        <em />
        <span><b>02 · {profile.defectB.split(" · ")[0]}</b><small>{profile.defectB.split(" · ")[1]} · MEASURED</small><i /></span>
      </span>
      <span className="precision-defect precision-defect--c">
        <i className="precision-reticle"><b /></i>
        <em />
        <span><b>03 · SURFACE MAP</b><small>FINGERPRINT MATCH · VERIFIED</small><i /></span>
      </span>
    </div>
  );
}

function PrecisionCardStage({ mode, onSelectCard }) {
  const interactive = mode === "gold";

  return (
    <div className={`precision-card-stage precision-card-stage--${mode}`} aria-hidden={!interactive || undefined}>
      {heroCardOrder.map(([profile, position]) => {
        const Tag = interactive ? "button" : "div";
        return (
          <Tag
            key={profile.id}
            {...(interactive ? {
              type: "button",
              "aria-label": `Inspect the ${profile.name} card defect fingerprint`,
              onClick: () => onSelectCard(profile.id),
            } : {})}
            className={`precision-hero-card precision-hero-card--${position}`}
          >
            <span className="precision-card-surface">
              <img src={profile.image} alt={interactive ? profile.imageAlt : ""} />
              {mode === "gold" ? (
                <>
                  <span className="precision-gold-film" />
                  <span className="precision-fingerprint" />
                  <span className="precision-measure precision-measure--x">63.50 MM</span>
                  <span className="precision-measure precision-measure--y">88.90 MM</span>
                  <span className="precision-map-node precision-map-node--a" />
                  <span className="precision-map-node precision-map-node--b" />
                  <span className="precision-map-node precision-map-node--c" />
                </>
              ) : (
                <PrecisionDefectMap profile={profile} />
              )}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}

function AtlasHeroArt({ selectedCard, inspecting, onSelectCard, onExit }) {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioRef = useRef(null);
  const soundEnabledRef = useRef(false);
  const precisionSceneRef = useRef(null);
  const profile = cardProfiles[selectedCard];

  const soundPing = useCallback(() => {
    if (!soundEnabledRef.current) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = audioRef.current || new AudioContext();
      audioRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(1180, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(690, context.currentTime + 0.06);
      gain.gain.setValueAtTime(0.028, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.075);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.08);
    } catch {
      // The visual scan remains complete when browser audio is unavailable.
    }
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    const scene = precisionSceneRef.current;
    if (!scene) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    let cycleStartedAt = performance.now();
    const travelStart = 6;
    const travelEnd = 94;
    const scanTime = 9800;
    const trailDelay = 2300;
    const resetHold = 900;
    const activeCycle = scanTime + trailDelay;
    const fullCycle = activeCycle + resetHold;
    const cardThresholds = [28, 50, 72];
    let lastCycleIndex = -1;
    const pingedCards = new Set();

    const setScan = (head, tail, opacity) => {
      scene.style.setProperty("--scan-head", `${head}%`);
      scene.style.setProperty("--scan-tail", `${tail}%`);
      scene.style.setProperty("--scan-right", `${100 - head}%`);
      scene.style.setProperty("--scan-opacity", String(opacity));
    };

    const animate = (now) => {
      if (reducedMotion.matches) {
        setScan(travelEnd, travelStart, 0);
        return;
      }

      const totalElapsed = now - cycleStartedAt;
      const cycleIndex = Math.floor(totalElapsed / fullCycle);
      const elapsed = totalElapsed % fullCycle;
      if (cycleIndex !== lastCycleIndex) {
        lastCycleIndex = cycleIndex;
        pingedCards.clear();
      }

      if (elapsed <= activeCycle) {
        const headProgress = clamp(elapsed / scanTime);
        const tailProgress = clamp((elapsed - trailDelay) / scanTime);
        const head = travelStart + (travelEnd - travelStart) * headProgress;
        const tail = travelStart + (travelEnd - travelStart) * tailProgress;
        const fadeIn = clamp(elapsed / 180);
        const fadeOut = clamp((scanTime - elapsed) / 220);
        setScan(head, tail, Math.min(fadeIn, fadeOut));

        cardThresholds.forEach((threshold, index) => {
          if (head >= threshold && !pingedCards.has(index)) {
            pingedCards.add(index);
            soundPing();
          }
        });
      } else {
        setScan(travelEnd, travelEnd, 0);
      }
      animationFrame = requestAnimationFrame(animate);
    };

    const restart = () => {
      cancelAnimationFrame(animationFrame);
      cycleStartedAt = performance.now();
      animationFrame = requestAnimationFrame(animate);
    };

    let cancelled = false;
    const startWhenReady = async () => {
      const images = [...scene.querySelectorAll("img")];
      await Promise.all(images.map((image) => image.decode?.().catch(() => undefined)));
      if (!cancelled) restart();
    };

    startWhenReady();
    reducedMotion.addEventListener?.("change", restart);
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      reducedMotion.removeEventListener?.("change", restart);
    };
  }, [soundPing]);

  return (
    <div
      className={`atlas-opening__art ${inspecting ? "is-inspecting" : ""}`}
      aria-label="ATLAS identity field and trading card defect scanner"
    >
      <div className="atlas-opening__glow" />
      <div className="atlas-opening__field">
        <div className="atlas-opening__scene" ref={precisionSceneRef}>
          <img
            className="precision-blueprint-base"
            src="/marketing/atlas-hero-blueprint.png"
            alt="Charizard, Kobe Bryant, and Tom Brady cards mapped with ATLAS gold fingerprints and precision measurements"
          />
          <PrecisionCardStage mode="gold" onSelectCard={onSelectCard} />
          <div className="precision-color-pass" aria-hidden="true">
            <PrecisionCardStage mode="color" />
          </div>
          <span className="precision-scanner" aria-hidden="true"><i /></span>
        </div>
        <span className="atlas-opening__grid" aria-hidden="true" />
        {!inspecting && (
          <>
            <div className="atlas-opening__instruction">
              <b>SELECT A RAW CARD TO INSPECT</b>
              <span>TAP A CARD · OPEN ITS DEFECT FINGERPRINT</span>
            </div>
          </>
        )}
        {inspecting && (
          <div className="hero-inspection-console" role="dialog" aria-label={`${profile.name} card ATLAS inspection`}>
            <div className="hero-console-header">
              <span><i /> DEMO DEFECT FINGERPRINT</span>
              <b>EXAMPLE SPECIMEN · {profile.name.toUpperCase()}</b>
              <button type="button" onClick={onExit}>RETURN TO ATLAS <span aria-hidden="true">×</span></button>
            </div>
            <div className="hero-console-stage">
              <div className="hero-console-card">
                <SpecimenCard profile={profile} showDefects />
                <span className="focus-card-scan" aria-hidden="true" />
              </div>
              <span className="hero-console-axis hero-console-axis--x">63.50 MM</span>
              <span className="hero-console-axis hero-console-axis--y">88.90 MM</span>
            </div>
            <aside className="hero-report-panel">
              <span className="hero-report-kicker">ATLAS / MEASUREMENT RECEIPT</span>
              <div className="hero-report-grade"><span>FINAL GRADE</span><strong>{profile.grade}</strong><small>MEASURED · CERTIFIED · PROVABLE</small></div>
              <div className="hero-report-lines">
                <span><small>CENTERING</small><b>8.27</b></span>
                <span><small>CORNERS</small><b>10.00</b></span>
                <span><small>EDGES</small><b>9.70</b></span>
                <span><small>SURFACE</small><b>10.00</b></span>
              </div>
              <div className="hero-report-status"><i />DEFECT MAP COMPLETE · HUMAN VERIFIED</div>
              <a href={REPORT_URL}>OPEN THE ATLAS RECORD <span aria-hidden="true">↗</span></a>
            </aside>
            <div className="hero-console-switcher" aria-label="Inspect another raw card">
              {Object.values(cardProfiles).map((card) => (
                <button key={card.id} type="button" className={card.id === selectedCard ? "is-selected" : ""} onClick={() => onSelectCard(card.id)}>{card.name}</button>
              ))}
            </div>
          </div>
        )}
        <span className="atlas-opening__status">{inspecting ? "EXAMPLE · INSPECTION" : "ATLAS · INTERACTIVE EXAMPLE"}</span>
        <span className="atlas-opening__coordinate">{inspecting ? "HUNDREDTH-MILLIMETER ANALYSIS" : "RAW CARD · FINGERPRINT · IDENTITY"}</span>
      </div>
      <p className="atlas-opening__meta">
        <span>{inspecting ? "DEFECT FINGERPRINT · MEASURED" : "ATLAS · KNOW WHAT YOU HAVE"}</span>
        <i />
        <span>{inspecting ? "ATLAS / EXAMPLE REPORT" : "SELECT A CARD TO INSPECT"}</span>
      </p>
      <button
        type="button"
        className={`atlas-opening__sound ${soundEnabled ? "is-on" : ""}`}
        aria-pressed={soundEnabled}
        onClick={() => setSoundEnabled((value) => !value)}
      >
        <span aria-hidden="true" />
        Scan audio {soundEnabled ? "on" : "off"}
      </button>
    </div>
  );
}

function formatJourneyTime(progress) {
  const totalMinutes = Math.round(clamp(progress / 100) * 48 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function activeJourneyIndex(progress) {
  const starts = [0, 8.333, 25, 75];
  return starts.reduce((active, start, index) => progress >= start ? index : active, 0);
}

function journeyChapterProgress(index, progress) {
  const starts = [0, 8.333, 25, 75];
  const ends = [8.333, 25, 75, 100];
  return clamp((progress - starts[index]) / (ends[index] - starts[index]));
}

function AtlasTimepiece({ progress }) {
  const time = formatJourneyTime(progress);
  const activeIndex = activeJourneyIndex(progress);
  const moment = journeyMoments[activeIndex];
  return (
    <div
      className="atlas-timepiece atlas-timepiece--luxury"
      style={{
        "--timepiece-angle": `${progress * 3.6 - 180}deg`,
        "--minute-angle": `${progress * 21.6}deg`,
        "--hour-angle": `${progress * 1.8 - 55}deg`,
        "--timepiece-progress": `${progress * 3.6}deg`,
      }}
      aria-label={`${time}, ${moment.label}`}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--glint-x", `${((event.clientX - rect.left) / rect.width) * 100}%`);
        event.currentTarget.style.setProperty("--glint-y", `${((event.clientY - rect.top) / rect.height) * 100}%`);
      }}
    >
      <div className="timepiece-case">
        <div className="timepiece-bezel">
          <div className="timepiece-indices" aria-hidden="true">
            {Array.from({ length: 48 }, (_, index) => (
              <i key={index} style={{ transform: `rotate(${index * 7.5}deg)` }} />
            ))}
          </div>
          <div className="timepiece-face">
            <span className="timepiece-brand"><AtlasGlyph small /> ATLAS</span>
            <span className="timepiece-dial-copy">PRECISION CERTIFICATION</span>
            <span className="timepiece-hand timepiece-hand--hour" />
            <span className="timepiece-hand timepiece-hand--minute" />
            <span className="timepiece-hand timepiece-hand--48" />
            <span className="timepiece-pin" />
            <div className="timepiece-complication">
              <strong>{time}</strong>
              <small>{moment.label}</small>
            </div>
            <span className="timepiece-caliber">CALIBER A48 · HUMAN CERTIFIED</span>
            <span className="timepiece-glass" aria-hidden="true" />
          </div>
        </div>
      </div>
      <span className="timepiece-crown" aria-hidden="true" />
    </div>
  );
}

function JourneySlab({ profile }) {
  return (
    <div className="journey-slab">
      <div className="journey-slab-label">
        <span><AtlasGlyph small /> ATLAS</span>
        <small>{profile.label}</small>
        <strong>{profile.grade}</strong>
        <i />
      </div>
      <SpecimenCard profile={profile} compact />
      <span className="journey-slab-seal">A</span>
    </div>
  );
}

const dealerPins = [
  { id: "SAC-01", region: "Sacramento", left: 72, top: 22 },
  { id: "SAC-02", region: "Sacramento", left: 79, top: 34 },
  { id: "SAC-03", region: "Sacramento", left: 68, top: 40 },
  { id: "BAY-01", region: "East Bay", left: 24, top: 61 },
  { id: "BAY-02", region: "East Bay", left: 33, top: 70 },
  { id: "BAY-03", region: "East Bay", left: 19, top: 77 },
];

function DealerNetworkMap({ progress, profile, selectedDealer, onSelectDealer }) {
  const routeProgress = clamp((progress - 7) / 25);
  return (
    <div className="dealer-network-map">
      <div className="map-region-label map-region-label--sac"><b>SACRAMENTO</b><span>03 EXAMPLE LOCATIONS</span></div>
      <div className="map-region-label map-region-label--bay"><b>EAST BAY</b><span>03 EXAMPLE LOCATIONS</span></div>
      <svg className="dealer-map-lines" viewBox="0 0 900 500" aria-hidden="true">
        <path className="map-water" d="M72 438 C125 360 128 292 210 245 C286 202 342 211 395 174 C445 139 478 89 546 59" />
        <path className="map-road" d="M214 371 C284 318 338 277 414 234 C492 190 555 151 644 117" />
        <path className="map-road map-road--two" d="M182 323 C268 301 350 297 437 251 C535 200 606 170 716 142" />
        <path className="map-courier-route" pathLength="100" d="M244 350 C345 300 405 262 486 222 C565 183 623 143 701 115" style={{ strokeDashoffset: 100 - routeProgress * 100 }} />
      </svg>
      {dealerPins.map((pin, index) => (
        <button
          key={pin.id}
          type="button"
          className={`dealer-pin ${selectedDealer === pin.id ? "is-selected" : ""}`}
          style={{ left: `${pin.left}%`, top: `${pin.top}%`, "--pin-delay": `${index * 120}ms` }}
          aria-label={`Explore example location ${pin.id}, ${pin.region}`}
          onClick={() => onSelectDealer(pin.id)}
        >
          <i />
          <span>{pin.id}</span>
        </button>
      ))}
      <span className="map-courier" style={{ left: `${24 + routeProgress * 48}%`, top: `${68 - routeProgress * 44}%` }}><AtlasGlyph small /></span>
      <div className="map-deposit-card"><SpecimenCard profile={profile} compact /></div>
      <span className="map-selected-dealer">ORIGIN · {selectedDealer}</span>
    </div>
  );
}

function JourneyScene({ progress, profile, selectedDealer, onSelectDealer }) {
  const activeIndex = activeJourneyIndex(progress);
  const local = journeyChapterProgress(activeIndex, progress);
  const moment = journeyMoments[activeIndex];
  return (
    <div className={`journey-cinema journey-cinema--chapter-${activeIndex + 1}`} style={{ "--journey-progress": `${progress}%`, "--chapter-progress": local }}>
      <div className="cinema-art">
        <span className="cinema-grid" aria-hidden="true" />
        <div key={activeIndex} className={`cinema-chapter cinema-chapter--${activeIndex + 1}`}>
          {activeIndex === 0 && <DealerNetworkMap progress={progress} profile={profile} selectedDealer={selectedDealer} onSelectDealer={onSelectDealer} />}
          {activeIndex === 1 && (
            <div className="cinema-courier">
              <div className="courier-corridor"><span>{selectedDealer}</span><i /><span>ATLAS FACILITY</span></div>
              <div className="luxury-case" style={{ transform: `translateX(-50%) perspective(800px) rotateX(4deg) translateY(${(1 - local) * 18}px)` }}>
                <span className="case-handle" /><span className="case-glint" />
                <div className="case-card"><SpecimenCard profile={profile} compact /></div>
                <span className="case-clasp"><AtlasGlyph small /></span>
                <b>ATLAS COURIER</b><small>SEALED · TRACKED · HAND CARRIED</small>
              </div>
            </div>
          )}
          {activeIndex === 2 && (
            <div className="cinema-grading">
              <div className="cinema-grade-card"><SpecimenCard profile={profile} compact showDefects /></div>
              <span className="cinema-scan-beam" style={{ left: `${11 + local * 48}%` }} />
              <div className="measurement-ledger">
                <span><small>IDENTITY</small><b>{selectedDealer} · MATCHED</b></span>
                <span><small>FIND</small><b>02 CANDIDATES</b></span>
                <span><small>VERIFY</small><b>HUMAN CERTIFIED</b></span>
                <span><small>COMPUTE</small><b>9.50 / 10</b></span>
              </div>
              <span className="cinema-human-stamp"><AtlasGlyph small /> HUMAN VERIFIED</span>
            </div>
          )}
          {activeIndex === 3 && (
            <div className="cinema-result">
              <span className="result-reflection" />
              <div className="cinema-result-slab" style={{ transform: `translateY(${(1 - local) * 24}px) scale(${.94 + local * .06})` }}><JourneySlab profile={profile} /></div>
              <div className="cinema-result-grade"><small>SEALED · CHIPPED · RETURNED</small><strong>{profile.grade}</strong><span>MEASURED · CERTIFIED · PROVABLE</span><a href={REPORT_URL}>VIEW THIS CARD’S ATLAS RECORD <i>↗</i></a></div>
              <div className="cinema-result-nfc"><i /><i /><span>NFC</span></div>
            </div>
          )}
          <span className="cinema-gold-wipe" aria-hidden="true" />
        </div>
      </div>
      <div className="cinema-copy" aria-live="polite" aria-atomic="true">
        <div key={moment.label} className="cinema-copy-active">
          <span>{formatJourneyTime(progress)} · {moment.label}</span>
          <h2>{moment.title}</h2>
          <p>{moment.copy}</p>
        </div>
      </div>
      <span className="cinema-stage-count">{String(activeIndex + 1).padStart(2, "0")} / 04</span>
      <span className="cinema-card-selected">{profile.name.toUpperCase()} CARD · {selectedDealer}</span>
    </div>
  );
}

function RolexJourney({ selectedCard }) {
  const [journeyProgress, setJourneyProgress] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState("SAC-01");
  const journeySectionRef = useRef(null);
  const hasAutoStarted = useRef(false);
  const profile = cardProfiles[selectedCard];

  useEffect(() => {
    const section = journeySectionRef.current;
    if (!section || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !hasAutoStarted.current) {
        hasAutoStarted.current = true;
        setAutoPlay(true);
      }
    }, { threshold: 0.22 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoPlay) return undefined;
    const timer = window.setInterval(() => {
      setJourneyProgress((value) => {
        const next = value + 0.1067;
        if (next >= 100) {
          window.setTimeout(() => setAutoPlay(false), 0);
          return 100;
        }
        return next;
      });
    }, 32);
    return () => window.clearInterval(timer);
  }, [autoPlay]);

  const toggleStory = () => {
    if (!autoPlay && journeyProgress >= 100) {
      setJourneyProgress(0);
      setAutoPlay(true);
      return;
    }
    setAutoPlay((value) => !value);
  };

  return (
    <section ref={journeySectionRef} className="rolex-journey full-bleed" id="journey" aria-labelledby="hero-title">
      <div className="rolex-journey-inner">
        <header className="journey-heading">
          <p className="hero-overline">DEALER DROP-OFF · MAIL-IN</p>
          <h1 id="hero-title"><span>The Rolex of</span><span>Grading.</span></h1>
          <p className="hero-tagline">KNOW WHAT YOU HAVE</p>
          <p className="hero-deck">Choose authorized-dealer drop-off or mail-in. Sign in with your mobile number, submit your cards, and follow their recorded progress.</p>
          <p className="journey-promise-line"><span>YOUR CARDS.</span> EVERY STEP.</p>
        </header>

        <div className="journey-chronograph-lockup">
          <div className="chronograph-promise chronograph-promise--left"><strong>YOUR WAY</strong><span>Dealer drop-off.<br />Mail-in.</span></div>
          <div className="journey-watch-showpiece">
            <span className="watch-aura" aria-hidden="true" />
            <AtlasTimepiece progress={journeyProgress} />
            <p><span>{formatJourneyTime(journeyProgress)}</span><i />ATLAS CALIBER A48</p>
          </div>
          <div className="chronograph-promise chronograph-promise--right"><strong>TRACKED</strong><span>Graded. Sealed.<br />Returned.</span></div>
        </div>

        <JourneyScene progress={journeyProgress} profile={profile} selectedDealer={selectedDealer} onSelectDealer={setSelectedDealer} />

        <div className="journey-controller" onWheel={(event) => {
          event.preventDefault();
          setAutoPlay(false);
          setJourneyProgress((value) => clamp(value + event.deltaY * 0.035, 0, 100));
        }}>
          <div className="journey-controller-topline">
            <span>EXPLORE THE JOURNEY · ILLUSTRATIVE TIMELINE</span>
            <button type="button" onClick={toggleStory}>
              {autoPlay ? "PAUSE STORY" : journeyProgress >= 100 ? "REPLAY STORY" : "PLAY STORY"}
            </button>
          </div>
          <div className="journey-range-wrap">
            <input
              type="range"
              min="0"
              max="1000"
              step="1"
              value={Math.round(journeyProgress * 10)}
              aria-label="Illustrative ATLAS journey"
              onPointerDown={() => setAutoPlay(false)}
              onChange={(event) => setJourneyProgress(Number(event.target.value) / 10)}
              style={{ "--journey-progress": `${journeyProgress}%` }}
            />
          </div>
          <ol className="journey-stops journey-stops--continuous">
            {journeyMoments.map((item, index) => (
              <li key={item.label} className={index <= activeJourneyIndex(journeyProgress) ? "is-active" : ""}>
                <i />
                <span>{item.time}</span>
                <small>{item.label}</small>
              </li>
            ))}
          </ol>
        </div>

        <p className="hero-proof">Choose dealer drop-off or mail-in when you create your submission. Confirm the intake instructions before handing over or sending cards. The demonstration above illustrates the process; your account shows recorded progress and confirmed service details.</p>
        <div className="hero-actions">
          <a className="button button--gold" href="/account/submit">Submit your cards</a>
          <a className="text-link" href="#measurement">See how ATLAS grades <span aria-hidden="true">↓</span></a>
        </div>
      </div>
    </section>
  );
}

function CaliperVisual() {
  return (
    <div className="caliper" role="img" aria-label="Caliper measuring a 0.45 millimeter defect">
      <div className="caliper-scale">
        {Array.from({ length: 21 }, (_, i) => (
          <i key={i} className={i % 5 === 0 ? "major" : ""} />
        ))}
      </div>
      <div className="caliper-jaw caliper-jaw--left" />
      <div className="caliper-jaw caliper-jaw--right" />
      <div className="defect-sample" />
      <div className="measure-bracket">
        <i />
        <span>0.45 mm</span>
        <i />
      </div>
      <div className="instrument-readout">
        <span>EDGE / BACK</span>
        <b>−0.30</b>
      </div>
    </div>
  );
}

function AnonymousSlab() {
  return (
    <div className="anonymous-slab" aria-label="Anonymous grading slab label">
      <div className="anonymous-label">
        <span>
          <b>2021 FOOTBALL #90</b>
          <small>CERTIFIED AUTHENTIC</small>
        </span>
        <strong>9.5<small>GEM MINT</small></strong>
      </div>
      <div className="anonymous-card">
        <span>?</span>
      </div>
    </div>
  );
}

function ScanCard({ side = "back", pin = "01" }) {
  return (
    <div className={`scan-card scan-card--${side}`} aria-hidden="true">
      <div className="scan-grid" />
      <div className="card-art">
        <span className="art-top">ATLAS REFERENCE</span>
        <span className="art-mark">A</span>
        <span className="art-bottom">2021 · #90</span>
      </div>
      <div className={`defect-pin defect-pin--${side}`}>
        <span>{pin}</span>
      </div>
      <div className={`magnifier magnifier--${side}`}>
        <span className="magnifier-mark" />
        <small>{side === "back" ? "0.45 × 6.75" : "3.05 × 6.85"}</small>
      </div>
    </div>
  );
}

function EvidenceCard({ code, category, title, values, note, side, pin }) {
  return (
    <article className="evidence-card">
      <div className="evidence-heading">
        <span>{code}</span>
        <span>{category}</span>
      </div>
      <h3>{title}</h3>
      <ScanCard side={side} pin={pin} />
      <dl className="evidence-values">
        {values.map(([label, value, tone]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={tone || ""}>{value}</dd>
          </div>
        ))}
      </dl>
      <p>{note}</p>
    </article>
  );
}

function CenteringVisual() {
  return (
    <div className="centering-visual">
      <div className="centering-card">
        <span className="center-v" />
        <span className="center-h" />
        <span className="centering-art">90</span>
        <span className="dimension dimension--left">51.2</span>
        <span className="dimension dimension--right">48.8</span>
        <span className="dimension dimension--top">36.2</span>
        <span className="dimension dimension--bottom">63.8</span>
      </div>
      <div className="centering-scores">
        <span>FRONT <b>8.23</b></span>
        <span>BACK <b>8.35</b></span>
      </div>
    </div>
  );
}

function CertifyIcon({ type }) {
  if (type === "find") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="28" cy="28" r="16" />
        <path d="m40 40 13 13M20 28h16M28 20v16" />
      </svg>
    );
  }
  if (type === "verify") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 6 53 16v15c0 14-8 22-21 27C19 53 11 45 11 31V16Z" />
        <path d="m21 31 7 7 15-17" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="10" y="8" width="44" height="48" rx="4" />
      <path d="M19 20h26M20 34h4M31 34h4M42 34h4M20 45h4M31 45h4M42 45h4" />
    </svg>
  );
}

function GradeLedger() {
  const rows = [
    ["Centering", "Front 8.23×70% + Back 8.35×30%", "8.27"],
    ["Corners", "Front 10.00×70% + Back 10.00×30%", "10.00"],
    ["Edges", "Front 10.00×70% + Back 9.00×30%", "9.70"],
    ["Surface", "Front 10.00×70% + Back 10.00×30%", "10.00"],
  ];
  return (
    <div className="grade-ledger">
      <div className="ledger-topline">
        <span>ATLAS · CERTIFICATION RECEIPT</span>
        <span>REPORT / 0090</span>
      </div>
      {rows.map(([name, math, result], index) => (
        <div className="ledger-row" key={name}>
          <span className="ledger-index">0{index + 1}</span>
          <div>
            <strong>{name}</strong>
            <small>{math}</small>
          </div>
          <b>{result}</b>
        </div>
      ))}
      <div className="ledger-total">
        <span>
          Final grade
          <small>4 subgrades, 25% each</small>
        </span>
        <strong>9.5 <i>/ 10</i></strong>
      </div>
      <div className="ledger-barcode" aria-hidden="true" />
    </div>
  );
}

function RegradeVisual() {
  return (
    <div className="regrade-visual">
      <div className="reroll-stack">
        {["9", "9", "10"].map((grade, index) => (
          <div className="reroll-card" key={`${grade}-${index}`}>
            <small>SUBMISSION 0{index + 1}</small>
            <b>{grade}</b>
          </div>
        ))}
        <span className="reroll-question">Which one was true?</span>
      </div>
      <div className="versus">VS.</div>
      <div className="measured-card">
        <small>ONE MEASURED CARD</small>
        <b>9.5</b>
        <span>EVERY TIME</span>
      </div>
    </div>
  );
}

function SealVisual() {
  return (
    <div className="seal-visual" aria-hidden="true">
      <div className="seal-slab">
        <div className="seal-label">
          <AtlasGlyph small />
          <span>ATLAS</span>
          <b>9.5</b>
          <i className="nfc-chip" />
        </div>
        <div className="seal-card-face">
          <span>SPEEDSTER</span>
          <b>90</b>
          <i className="fingerprint-lines" />
        </div>
      </div>
      <div className="tap-phone">
        <span className="tap-screen">
          <AtlasGlyph small />
          <b>IDENTITY MATCH</b>
          <small>LIVE REPORT · VERIFIED</small>
        </span>
      </div>
      <i className="tap-wave tap-wave-a" />
      <i className="tap-wave tap-wave-b" />
      <i className="tap-wave tap-wave-c" />
    </div>
  );
}

function ChainStep({ number, title, children }) {
  return (
    <article className="chain-step">
      <span className="chain-number">{number}</span>
      <div className="chain-node">
        <AtlasGlyph small />
      </div>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </article>
  );
}

function GradedSlab() {
  return (
    <div className="graded-slab" aria-label="ATLAS graded slab, grade 9.5">
      <div className="slab-glint" />
      <div className="graded-label">
        <span className="label-brand">
          <AtlasGlyph small />
          <b>ATLAS</b>
        </span>
        <span className="label-card">
          2021 FOOTBALL #90
          <small>SPEEDSTER · CERTIFIED</small>
        </span>
        <strong>9.5<small>GEM MINT</small></strong>
        <i className="slab-chip" />
      </div>
      <div className="slab-card-art">
        <span className="speed-lines" />
        <span className="slab-series">SPEEDSTER</span>
        <span className="slab-number">90</span>
        <span className="slab-player" />
      </div>
      <div className="slab-seal">A</div>
    </div>
  );
}

function FinalScanner() {
  const stageRef = useRef(null);
  const dragRef = useRef({ active: false });
  const scanRef = useRef(0);
  const [scan, setScan] = useState(0);
  const opened = scan >= 100;

  const clickSound = useCallback((complete = false) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(complete ? 1380 : 820, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(complete ? 920 : 360, context.currentTime + 0.055);
      gain.gain.setValueAtTime(complete ? 0.045 : 0.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.07);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.075);
      setTimeout(() => context.close(), 110);
    } catch {
      // The scanner remains fully functional when browser audio is unavailable.
    }
  }, []);

  const updateScan = useCallback(
    (nextValue) => {
      const value = clamp(nextValue, 0, 100);
      const previous = scanRef.current;
      if (Math.floor(value / 10) > Math.floor(previous / 10)) {
        clickSound(value >= 100);
        if (navigator.vibrate) navigator.vibrate(6);
      }
      scanRef.current = value;
      setScan(value);
      if (value >= 100 && previous < 100) {
        if (navigator.vibrate) navigator.vibrate([25, 30, 50]);
      }
    },
    [clickSound]
  );

  const updateFromPointer = useCallback((event) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    updateScan(((event.clientX - rect.left) / rect.width) * 100);
  }, [updateScan]);

  const onPointerDown = (event) => {
    if (opened) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current.active = true;
    updateFromPointer(event);
  };

  const onPointerMove = (event) => {
    if (!dragRef.current.active || opened) return;
    updateFromPointer(event);
  };

  const onPointerUp = () => {
    dragRef.current.active = false;
  };

  const onKeyDown = (event) => {
    if (["ArrowRight", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      updateScan(scanRef.current + 10);
    }
    if (["ArrowLeft", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      updateScan(scanRef.current - 10);
    }
  };

  return (
    <div className={`final-verifier ${opened ? "is-open" : ""}`}>
      <div
        className="final-scan-stage"
        ref={stageRef}
        role="slider"
        tabIndex={0}
        aria-label="Move the ATLAS scanner from left to right to release the certified card"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(scan)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{ "--final-scan": `${scan}%` }}
      >
        <div className="final-certified-card">
          <GradedSlab />
        </div>
        <div className="final-unscanned">
          <img src="/marketing/atlas-brand.png" alt="" />
          <span className="final-scan-grid" />
          <span className="final-lock-copy">CERTIFIED OBJECT · LOCKED</span>
        </div>
        <div className="final-scan-line">
          <i />
          <span>{String(Math.round(scan)).padStart(2, "0")}%</span>
        </div>
      </div>
      <div className="final-scan-control">
        <p>{opened ? "IDENTITY VERIFIED" : "DRAG THE SCANNER LEFT TO RIGHT"}</p>
        <div className="final-scan-progress">
          <i style={{ width: `${scan}%` }} />
        </div>
        <span>{opened ? "DEMONSTRATION · CERTIFIED CARD RELEASED" : `${Math.round(scan)}% · DEFECT FINGERPRINT MATCH`}</span>
      </div>
      <a className="button button--gold final-report" href={REPORT_URL}>
        View this card’s ATLAS Record
        <span aria-hidden="true">↓</span>
      </a>
    </div>
  );
}

export default function AtlasSite() {
  const [selectedCard, setSelectedCard] = useState("sports");
  const [heroInspecting, setHeroInspecting] = useState(false);

  return (
    <main id="top" className="atlas-homepage">
      <nav className="top-nav" aria-label="Primary navigation">
        <Wordmark />
        <a href="/account">Your account</a>
        <a className="nav-report" href="/account/submit">
          Submit cards <span>↗</span>
        </a>
      </nav>

      <section className="atlas-opening full-bleed" aria-label="Choose and scan an ATLAS card specimen">
        <div className="atlas-opening__background-grid" />
        <AtlasHeroArt
          selectedCard={selectedCard}
          inspecting={heroInspecting}
          onSelectCard={(profileId) => {
            setSelectedCard(profileId);
            setHeroInspecting(true);
          }}
          onExit={() => setHeroInspecting(false)}
        />
        <div className="atlas-opening__scroll" aria-hidden="true">
          <span>SELECT A CARD · EXPLORE THE ATLAS JOURNEY</span>
          <i />
        </div>
      </section>

      <AtlasProofRibbon />

      <RolexJourney selectedCard={selectedCard} />

      <section className="measurement section-shell" id="measurement" aria-labelledby="measurement-title">
        <SectionIntro number="01" label="THE MEASUREMENT STANDARD" title="Every grade ever given was an opinion. Until now." id="measurement-title" />
        <CaliperVisual />
        <p className="precision-caption">
          The mark above cost this card exactly 0.30 points. We know because we measured it. You know because we show you. On a valuable card, one tenth of a point can mean thousands of dollars.
        </p>
      </section>

      <div className="hairline" />

      <section className="old-way section-shell" aria-labelledby="old-way-title">
        <SectionIntro number="02" label="HOW GRADING HAS ALWAYS WORKED" title="Your card disappears into a building. Experts look at it. A number comes back. The number is final. The reasons stay in the building." id="old-way-title" />
        <div className="old-way-layout">
          <AnonymousSlab />
          <div>
            <p className="caption-label">THE INDUSTRY STANDARD</p>
            <p>
              The industry standard: a number, sealed in plastic. Where did it come from? You’re not told.
            </p>
          </div>
        </div>
        <p className="kicker">We built the opposite.</p>
      </section>

      <section className="step-measure full-bleed" aria-labelledby="step-measure-title">
        <div className="section-shell">
          <SectionIntro number="03" label="STEP ONE — MEASURE" title="Every flaw: found, traced by hand, measured to the hundredth of a millimeter — and pinned exactly where it happened." id="step-measure-title" />
          <div className="evidence-grid">
            <EvidenceCard
              code="DEFECT A · PIN 01"
              category="EDGES · BACK"
              title="Visible whitening"
              side="back"
              pin="01"
              values={[
                ["Dimensions", "0.45 × 6.75 mm"],
                ["Area", "2.73 mm²"],
                ["Card coverage", "0.52%"],
                ["Grade impact", "−0.30", "negative"],
              ]}
              note="This mark cost this card exactly three tenths of a point. Not ’about a nine.’ Not ’in our opinion.’ Measured, weighted, computed."
            />
            <EvidenceCard
              code="DEFECT B · PIN 02"
              category="SURFACE · FRONT"
              title="Faint print/color"
              side="front"
              pin="02"
              values={[
                ["Dimensions", "3.05 × 6.85 mm"],
                ["Area", "4.46 mm²"],
                ["Card coverage", "0.09%"],
                ["Grade impact", "−0.00", "neutral"],
              ]}
              note="This one cost nothing. We logged it anyway. An honest grade includes the flaws that didn’t matter — so you know we found them all."
            />
          </div>
          <article className="centering-card-wrap">
            <div>
              <p className="section-code"><span>PIN 03</span>CENTERING</p>
              <h3>L/R 51.2/48.8, T/B 36.2/63.8.</h3>
              <p>
                Centering isn’t eyeballed. The borders are measured, the split is computed, and the score comes from the numbers you see here: front 8.23, back 8.35 — out of 10.
              </p>
            </div>
            <CenteringVisual />
          </article>
        </div>
      </section>

      <section className="certify section-shell" aria-labelledby="certify-title">
        <SectionIntro number="04" label="STEP TWO — CERTIFY" title="Machines are precise. People are accountable. An ATLAS grade requires both." id="certify-title" />
        <div className="certify-steps">
          <article>
            <span className="certify-number">01</span>
            <CertifyIcon type="find" />
            <h3>FIND</h3>
            <p>AI vision scans the card and proposes every candidate defect. Nothing is too small to flag.</p>
          </article>
          <article>
            <span className="certify-number">02</span>
            <CertifyIcon type="verify" />
            <h3>VERIFY</h3>
            <p>A human inspects every proposal and traces what’s real. Nothing counts until a person confirms it.</p>
          </article>
          <article>
            <span className="certify-number">03</span>
            <CertifyIcon type="compute" />
            <h3>COMPUTE</h3>
            <p>The grade is calculated from verified measurements. No mood. No reputation. No Monday-morning grader.</p>
          </article>
        </div>
      </section>

      <section className="total full-bleed" aria-labelledby="total-title">
        <div className="section-shell total-layout">
          <div>
            <SectionIntro number="05" label="STEP THREE — TOTAL" title="Then the grade is simply arithmetic." id="total-title" />
            <p className="calculator-line">Check it. Grab a calculator. We’ll wait.</p>
          </div>
          <GradeLedger />
        </div>
        <p className="total-question">If a grade can’t survive arithmetic — what is it?</p>
      </section>

      <section className="regrade section-shell" aria-labelledby="regrade-title">
        <SectionIntro number="06" label="THE RE-GRADE TEST" title="You’ve seen a card cracked out of its slab and resubmitted for a higher grade. Everyone has." id="regrade-title" />
        <RegradeVisual />
        <p className="large-body">
          Think about what that means. Same card. Same condition. Different number. The grade was never a property of the card — it was a property of the day.
        </p>
        <p className="kicker">A measured grade has no third try. There’s nothing to re-roll.</p>
      </section>

      <section className="seal full-bleed" id="atlas-record" aria-labelledby="seal-title">
        <div className="section-shell">
          <SectionIntro number="07" label="THE SEAL · NFC" title="A grade you can check deserves a label you can’t fake." id="seal-title">
            <p className="large-body">
              You know the stories. Slabs cracked open, gem labels resealed over lesser cards. Counterfeit shells wrapped around genuine flips. Cert numbers copied onto fakes — so the lookup page validates the fraud. Dealers have lost tens of thousands of dollars at a single table to slabs that passed every eye test.
            </p>
          </SectionIntro>
          <SealVisual />
          <div className="seal-panels">
            <article>
              <span>01 · THE LABEL SWAP</span>
              <h3>The label swap</h3>
              <p>
                The label is genuine. The QR code scans. The cert page loads. And the card underneath is not the card that earned the grade. Every check the industry taught you passes — because every check inspects the label, not the card.
              </p>
            </article>
            <p className="tap-tagline">If you can’t tap it, you can’t trust it.</p>
            <article>
              <span>02 · CHIP VS CODE</span>
              <h3>Chip vs code</h3>
              <p>
                A QR code is a picture — photograph it, reprint it, done. The ATLAS chip is silicon: written once, locked by us, embedded in the label. It can’t be photocopied. One tap with any phone opens the card’s living report.
              </p>
            </article>
            <article>
              <span>03 · DEFECT FINGERPRINT</span>
              <h3>Defect fingerprint</h3>
              <p>
                Every card’s flaws are its fingerprint — position, size, shape, measured to the hundredth of a millimeter. Tap the chip, pull the certified map, and compare it to the card in front of you. A swapped card fails in seconds — even under a genuine label. No two cards on earth share a fingerprint.
              </p>
            </article>
          </div>
          <p className="kicker seal-kicker">Fraud lives in the gap between a label and a card. We closed it.</p>
        </div>
      </section>

      <section className="custody section-shell" id="how-you-get-one" aria-labelledby="custody-title">
        <aside className="atlas-scarcity-callout" aria-label="ATLAS submission standard">
          <span>DEALER DROP-OFF · MAIL-IN SUBMISSIONS</span>
          <strong>NOT EVERY CARD<br />GETS INTO ATLAS.</strong>
          <p>IF EVERYTHING CAN BE ATLAS,<br />ATLAS MEANS NOTHING.</p>
        </aside>
        <SectionIntro number="08" label="HOW YOU GET ONE" title="Your cards. Your choice. Submit through an authorized dealer or choose mail-in, with your cards and return details recorded from the start." id="custody-title" />
        <div className="chain">
          <ChainStep number="01" title="SUBMIT">
            Sign in and choose dealer drop-off or mail-in.
          </ChainStep>
          <ChainStep number="02" title="CONFIRMED RECEIPT">
            Follow your intake instructions. ATLAS records receipt of each physical card.
          </ChainStep>
          <ChainStep number="03" title="GRADING & REVIEW">
            Measurements and findings enter human review before the final report is approved.
          </ChainStep>
          <ChainStep number="04" title="SEALED">
            The chain of custody never breaks — from your hand, to ours, to yours.
          </ChainStep>
        </div>
        <p className="large-body selective-copy">
          ATLAS is selective. Not every card needs certification, and not every submission gets one. A grade only means something if it can’t be handed out carelessly. Scarcity isn’t a marketing trick here — it’s quality control.
        </p>

        <div className="turnaround"><p className="section-code"><span>YOUR SUBMISSION</span>RECORDED PROGRESS</p><div className="time-row time-row--atlas"><div><span>Dealer drop-off or mail-in</span><b>Follow every card</b></div><p>Confirm current intake instructions, service details and return arrangements for your submission.</p><i /></div></div><p className="kicker">Royalty isn’t a price point. It’s a chain that never breaks.</p>
      </section>

      <section className="options full-bleed" id="options" aria-labelledby="options-title">
        <div className="section-shell">
          <SectionIntro number="09" label="COMPARISON" title="Know your options." id="options-title" />
          <div className="comparison-scroll" tabIndex="0" aria-label="Grading options comparison table, scroll horizontally on small screens">
            <table>
              <thead>
                <tr>
                  <th scope="col">THE CHECK</th>
                  <th scope="col">THE LEGACY HOUSES</th>
                  <th scope="col">THE ROBOGRADERS</th>
                  <th scope="col" className="atlas-column">ATLAS</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row[0]}>
                    <th scope="row">{row[0]}</th>
                    <td>{row[1]}</td>
                    <td>{row[2]}</td>
                    <td className="atlas-column">{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-note">
            We named no one, and we don’t need to — every claim in our column is printed on every report we issue. Verify us first. That’s the point.
          </p>
        </div>
      </section>

      <section className="vault-finale section-shell" aria-labelledby="vault-title">
        <SectionIntro number="10" label="THE FINAL CHECK" title="The final check. Your card. Its report. Together." id="vault-title" />
        <FinalScanner />
      </section>

      <section className="close full-bleed" aria-labelledby="close-title">
        <div className="close-mark"><AtlasGlyph /></div>
        <div className="section-shell close-inner">
          <h2 id="close-title">
            The next time a grade comes back — from anywhere — ask what each mark cost you. Every ATLAS grade answers before you ask. Keep your slabs. Start with the raw cards you’ve been afraid to submit.
          </h2>
          <div className="close-actions">
            <a className="button button--gold" href={REPORT_URL}>
              Inspect an ATLAS Record <span aria-hidden="true">↑</span>
            </a>
            <a className="button button--outline" href="/account/submit">
              Submit your cards
            </a>
          </div>
        </div>
      </section>

      <footer>
        <Wordmark />
        <p>ATLAS — Measured. Transparent. Built to be inspected.<br /><a href="/admin">Staff sign in</a></p>
        <span>© 2026 ATLAS</span>
      </footer>
    </main>
  );
}
