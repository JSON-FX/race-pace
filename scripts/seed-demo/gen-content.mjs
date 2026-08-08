// Generates 01-event-content.sql — every remaining empty field on `events`
// and `categories`, plus add-ons and custom form fields for every event.
//
// Routes are synthesised, not imported: there is no real GPX for these fictional
// races. Each line is fitted to the longest category's distance and the event's
// published vertical gain, so the course map and the numbers on the page agree.

import { writeFileSync } from "node:fs";

const OUT = process.argv[2];

/** Deterministic PRNG — the same seed must always produce the same course, or
 *  re-running this script rewrites every route for no reason. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const la1 = rad(a[1]);
  const la2 = rad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const lengthKm = (pts) => {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += haversine(pts[i - 1], pts[i]);
  return m / 1000;
};

/** Metres -> degrees at a given latitude. Longitude shrinks with cos(lat); at
 *  8°N that is a 1% error if ignored over a 60 km course, which is enough to
 *  make a "loop" not close. */
function degPerMetre(lat) {
  return { dLat: 1 / 110574, dLng: 1 / (111320 * Math.cos(rad(lat))) };
}

/**
 * A closed loop: radius modulated by three harmonics so it reads as a real
 * course (spurs, switchback bulges) rather than a circle.
 */
function loopShape(start, n, seed) {
  const r = rng(seed);
  const h = [
    { k: 2 + Math.floor(r() * 2), a: 0.18 + r() * 0.16, p: r() * 6.283 },
    { k: 4 + Math.floor(r() * 3), a: 0.1 + r() * 0.1, p: r() * 6.283 },
    { k: 7 + Math.floor(r() * 4), a: 0.04 + r() * 0.05, p: r() * 6.283 },
  ];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2 * Math.PI;
    let rr = 1;
    for (const { k, a, p } of h) rr += a * Math.sin(k * t + p);
    pts.push([Math.cos(t) * rr, Math.sin(t) * rr]);
  }
  // Force exact closure: the harmonics already agree at t=0 and t=2π, but
  // floating point does not, and an unclosed loop shows as a gap on the map.
  pts[pts.length - 1] = [...pts[0]];
  return pts;
}

/** A point-to-point line from (0,0) to (1,0), meandering perpendicular to it. */
function traverseShape(n, seed) {
  const r = rng(seed);
  const h = [
    { k: 1.5 + r(), a: 0.16 + r() * 0.12, p: r() * 6.283 },
    { k: 3.5 + r() * 2, a: 0.07 + r() * 0.07, p: r() * 6.283 },
    { k: 8 + r() * 4, a: 0.02 + r() * 0.03, p: r() * 6.283 },
  ];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let off = 0;
    for (const { k, a, p } of h) off += a * Math.sin(k * Math.PI * t + p);
    // Taper the meander to zero at both ends so start/finish sit exactly on
    // the coordinates published in start_lat/finish_lat.
    pts.push([t, off * Math.sin(Math.PI * t)]);
  }
  return pts;
}

/**
 * Elevation along the course. `gain` is the event's published vertical gain, so
 * the profile is scaled until the sum of positive deltas matches it — the number
 * in the hero strip and the shape of the line are then the same fact.
 */
function elevations(n, base, gain, seed, terrain) {
  const r = rng(seed);
  const climbs = terrain ? 2 + Math.floor(r() * 3) : 3 + Math.floor(r() * 3);
  const h = [];
  for (let i = 0; i < climbs; i++) h.push({ k: i + 1, a: 1 / (i + 1), p: r() * 6.283 });
  const raw = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let v = 0;
    for (const { k, a, p } of h) v += a * Math.sin(k * Math.PI * 2 * t + p);
    // A little high-frequency roughness, or the profile reads as a synthesiser
    // output rather than ground.
    v += (terrain ? 0.06 : 0.02) * Math.sin(23 * Math.PI * t + 1.1);
    raw.push(v);
  }
  let up = 0;
  for (let i = 1; i < n; i++) up += Math.max(0, raw[i] - raw[i - 1]);
  const scale = up > 0 ? gain / up : 0;
  return raw.map((v) => Math.round(base + v * scale));
}

/** Build the final [[lng,lat,ele],...] line. */
function buildRoute(ev) {
  const n = 200;
  const seed = ev.seed;
  const { dLat, dLng } = degPerMetre(ev.start[0]);
  const terrain = ev.terrain;
  const shape = ev.finish ? traverseShape(n, seed) : loopShape(ev.start, n, seed);

  let pts;
  if (ev.finish) {
    const spanLat = ev.finish[0] - ev.start[0];
    const spanLng = ev.finish[1] - ev.start[1];
    // Perpendicular direction in degree space, normalised by metre scale.
    const px = -spanLat * (dLng / dLat);
    const py = spanLng * (dLat / dLng);
    const scaleTo = (mult) =>
      shape.map(([t, o]) => [
        ev.start[1] + spanLng * t + px * o * mult,
        ev.start[0] + spanLat * t + py * o * mult,
      ]);
    // The straight-line distance is fixed by the two endpoints, so the meander
    // amplitude is the only free variable; solve for the published distance.
    let lo = 0, hi = 6;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (lengthKm(scaleTo(mid)) < ev.km) lo = mid; else hi = mid;
    }
    pts = scaleTo((lo + hi) / 2);
  } else {
    const scaleTo = (rMetres) =>
      shape.map(([x, y]) => [
        ev.start[1] + x * rMetres * dLng,
        ev.start[0] + y * rMetres * dLat,
      ]);
    let lo = 100, hi = 40000;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (lengthKm(scaleTo(mid)) < ev.km) lo = mid; else hi = mid;
    }
    pts = scaleTo((lo + hi) / 2);
  }

  const ele = elevations(n, ev.base, ev.gain, seed + 977, terrain);
  return pts.map(([lng, lat], i) => [
    Number(lng.toFixed(6)),
    Number(lat.toFixed(6)),
    ele[i],
  ]);
}

const IMG = (org, file) =>
  `https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/${org}/${file}`;

const A1 = "00000000-0000-0000-0000-00000000a001";
const A2 = "00000000-0000-0000-0000-00000000a002";

// Every object already in the event-images bucket, so galleries reference real
// files rather than an external host that could go away.
const POOL_A1 = [
  "000aaf63-170b-4d83-b2ce-264b9b66a98a.jpg", "0c1364d4-6c26-4084-98c2-114c3ee92f23.jpg",
  "2407f578-6e02-4a9b-abc4-3a8356057398.jpg", "28a77a6a-648b-47dd-b07a-a972317997b1.jpg",
  "394196c8-5728-4e5d-935c-e99276c30553.jpg", "48f40b78-b896-4f58-8fe4-204afd612439.jpg",
  "5b9ef4e9-2bfd-4b2b-8376-3f79bac05a97.jpg", "6e2e05ad-decd-4713-8d90-c29b77e3639f.jpg",
  "7541d08d-be55-4972-bc9c-6c2e3c50aefd.jpg", "8391869f-7b40-47ce-bed0-be6dd580dd24.jpg",
  "d200cb67-370c-4df5-82ed-4c4aee73b3b3.jpg", "d7d9c836-f407-4b75-b8ee-2bd83ad9143e.jpg",
].map((f) => IMG(A1, f));
const POOL_A2 = [
  "1d1af234-8ee6-4dcc-b415-39c036d76d97.jpg", "3190f573-9905-4508-b568-185558e665e4.jpg",
  "50397d0f-2447-442a-b099-dcec8c567be8.jpg", "733e6ad1-d063-4645-a049-721e41c6c2d6.jpg",
  "7bdfd18f-22b9-4eeb-aeae-6e790d34ab5b.jpg", "a8de85f1-518f-44c2-be4f-9f2911deb0ea.jpg",
  "c03900f7-26d5-4522-8b10-54c20520d96e.jpg", "c638883f-056e-4298-b02e-58db177e8f7a.jpg",
  "dd88eb9c-5b37-4459-8a5f-d51902ea0a14.jpg", "df63f121-e229-4581-8fbc-2a52f610897e.jpg",
].map((f) => IMG(A2, f));

const gallery = (org, i, k = 5) => {
  const pool = org === A1 ? POOL_A1 : POOL_A2;
  return Array.from({ length: k }, (_, j) => pool[(i * 3 + j * 2) % pool.length]);
};

// ── The twenty events ────────────────────────────────────────────────────────
// start/finish are [lat, lng]. `finish` null = loop course (finish = start),
// which is what the CourseLocator renders as a single "Start / Finish" marker.
const EVENTS = [
  {
    id: "00000000-0000-0000-0000-000000010000", org: A1, seed: 1001,
    start: [8.0705, 124.9385], finish: null, km: 65, gain: 2890, base: 1180, terrain: true,
    place: "Lantapan, Bukidnon",
    desc: "Sixty-five kilometres along the spine of the Kitanglad Range, from the park gate at Lantapan to the shoulder of Mt. Dulang-Dulang and back down through the mossy forest. Above 2,000 metres the trail is root, rock and cloud, and the ridge stays exposed for eleven straight kilometres. Qualifier required for the 65K; the 35K and 18K open to anyone who has finished a trail race before. Aid every 8 to 12 km, drop bag at Kilometre 34.",
    note: "Mandatory gear check runs 14:00–20:00 the day before at the park gate. No check, no bib — no exceptions.",
    incl: ["Race bib with timing chip", "Finisher medal and buckle for the 65K", "Technical race singlet", "Full aid stations with hot food from KM34", "Marshalled course with sweep team", "Drop-bag transport to KM34", "Post-race meal and shower at the park gate", "Race insurance for the duration"],
    sched: [{ time: "02:00", label: "Bag drop and final gear check opens" }, { time: "03:30", label: "Race briefing, 65K" }, { time: "04:00", label: "Gun start, 65K Skyline" }, { time: "05:30", label: "Gun start, 35K" }, { time: "07:00", label: "Gun start, 18K" }, { time: "13:00", label: "First 18K finishers expected" }, { time: "18:00", label: "Awarding, 18K and 35K" }, { time: "02:00", label: "Course closes, 65K cut-off" }],
    addons: [["Kitanglad Finisher Jacket", 185000], ["Drop Bag Service, KM34", 45000], ["Pre-race Bunk, Park Gate", 90000], ["Trail Photo Pack", 60000]],
  },
  {
    id: "00000000-0000-0000-0000-000000010001", org: A1, seed: 1002,
    start: [8.0512, 125.0104], finish: null, km: 28, gain: 1780, base: 980, terrain: true,
    place: "Barangay Songco, Lantapan, Bukidnon",
    desc: "The shortest line to the second-highest peak in the Philippines. From Songco the trail goes up and keeps going up — 1,780 metres of gain packed into a 28-kilometre out-and-back, with the last four kilometres through the mossy forest that gives D'Nino its reputation. There is no runnable descent until the turnaround. Bring poles.",
    note: "Barangay Songco limits daily entries to the summit trail. The 28K field is capped and will not be extended on race week.",
    incl: ["Race bib with timing chip", "Finisher medal", "Race singlet", "Aid stations at KM7, KM14 and KM21", "Marshalled course with sweep team", "Summit photo", "Post-race meal at Songco covered court"],
    sched: [{ time: "03:30", label: "Registration and gear check opens" }, { time: "04:40", label: "Race briefing" }, { time: "05:00", label: "Gun start, 28K Vertical" }, { time: "06:00", label: "Gun start, 14K" }, { time: "11:00", label: "First 28K finishers expected" }, { time: "15:00", label: "Awarding" }, { time: "17:00", label: "Course closes" }],
    addons: [["Summit Finisher Tee", 75000], ["Trekking Pole Rental", 35000], ["Shuttle from Malaybalay", 40000]],
  },
  {
    id: "00000000-0000-0000-0000-000000010002", org: A1, seed: 1003,
    start: [8.1489, 125.1214], finish: null, km: 32, gain: 1240, base: 620, terrain: true,
    place: "Kaamulan Grounds, Malaybalay, Bukidnon",
    desc: "A highland loop that leaves the Kaamulan Grounds on pavement and is on singletrack inside twenty minutes. The course climbs through pine and falcata plantations above the city, crosses two river fords, and returns along the ridge road with the whole Malaybalay basin below. Three distances, one start arch, and a course friendly enough that the 8K is where most Bukidnon runners meet trail for the first time.",
    note: "Race kit claiming: 5–6 November, Kaamulan Grounds pavilion, 09:00–18:00. Bring a valid ID or an authorisation letter.",
    incl: ["Race bib with timing chip", "Finisher medal", "Cotton race shirt", "Aid stations every 6 km", "Marshalled course with sweep team", "Baggage deposit", "Post-race meal and coffee"],
    sched: [{ time: "04:00", label: "Baggage deposit and assembly opens" }, { time: "05:15", label: "Race briefing" }, { time: "05:30", label: "Gun start, 32K" }, { time: "06:00", label: "Gun start, 16K" }, { time: "06:30", label: "Gun start, 8K" }, { time: "09:00", label: "First 32K finishers expected" }, { time: "12:00", label: "Awarding" }, { time: "15:30", label: "Course closes" }],
    addons: [["Highland Finisher Tee", 65000], ["Extra Race Photo Pack", 45000], ["Shuttle from Cagayan de Oro", 55000]],
  },
  {
    id: "00000000-0000-0000-0000-000000010003", org: A1, seed: 1004,
    start: [8.3068, 125.0041], finish: null, km: 42, gain: 1610, base: 520, terrain: true,
    place: "Impasug-Ong, Bukidnon",
    desc: "Forty-two kilometres over the ridges north of Impasug-Ong, on cattle trails and logging roads that see almost no traffic. The course rolls constantly — there is no single long climb, just eleven of them — and the middle section runs above the Tagoloan river with the ridge dropping away on both sides. Cool for most of the morning, brutally exposed from ten o'clock on.",
    note: "The KM26 river crossing is marshalled and roped. If the marshal calls it, you take the high detour — that decision is not negotiable on course.",
    incl: ["Race bib with timing chip", "Finisher medal", "Technical race singlet", "Aid stations every 7 km", "Marshalled course with sweep team", "Hydration refill at all stations", "Post-race meal at the municipal plaza", "Race insurance for the duration"],
    sched: [{ time: "03:00", label: "Assembly and gear check opens" }, { time: "04:10", label: "Race briefing" }, { time: "04:30", label: "Gun start, 42K Ridge" }, { time: "05:30", label: "Gun start, 21K" }, { time: "06:30", label: "Gun start, 10K" }, { time: "10:00", label: "First 42K finishers expected" }, { time: "14:00", label: "Awarding" }, { time: "18:30", label: "Course closes" }],
    addons: [["Ridge Finisher Jacket", 145000], ["Camp Slot, Race Eve", 70000], ["Race Photo Pack", 50000]],
  },
  {
    id: "00000000-0000-0000-0000-000000010004", org: A1, seed: 1005,
    start: [8.2361, 124.6042], finish: null, km: 22, gain: 980, base: 700, terrain: true,
    place: "Talakag, Bukidnon",
    desc: "A cross-country loop through the second-growth forest west of Talakag, run almost entirely under canopy. The footing is soft, the climbs are short and repeated, and the course crosses the same creek four times at four different points. It is the friendliest true trail race on the Muspo calendar and the one that fills with first-timers.",
    note: "Race kit claiming: 21–22 January at the Talakag Municipal Gym, 09:00–17:00.",
    incl: ["Race bib with timing chip", "Finisher medal", "Cotton race shirt", "Aid stations every 5 km", "Marshalled course with sweep team", "Baggage deposit", "Post-race meal"],
    sched: [{ time: "04:30", label: "Assembly and baggage deposit opens" }, { time: "05:45", label: "Race briefing" }, { time: "06:00", label: "Gun start, 25K" }, { time: "06:30", label: "Gun start, 12K" }, { time: "09:30", label: "First finishers expected" }, { time: "12:00", label: "Awarding" }, { time: "14:00", label: "Course closes" }],
    addons: [["Forest Loop Finisher Tee", 60000], ["Race Photo Pack", 40000]],
  },
  {
    id: "00000000-0000-0000-0000-000000010005", org: A1, seed: 1006,
    start: [7.9601, 124.8062], finish: [7.8341, 124.8183], km: 80, gain: 3120, base: 760, terrain: true,
    place: "Kalatungan Mountain Range, Pangantucan, Bukidnon",
    desc: "A true traverse: eighty kilometres and 3,120 metres of climbing from the northern approach to the Kalatungan Range down to the finish arch in Pangantucan, crossing four of the five peaks on the way. Self-supported between KM18 and KM41 — that is a six-hour stretch with one water point and no road access. The 50K joins at the KM30 saddle. This is the hardest race in the Muspo calendar and it is meant to be.",
    note: "Race in progress. Live results are posted at the finish arch in Pangantucan.",
    incl: ["Race bib with timing chip", "Finisher buckle and medal", "Technical race singlet", "Aid stations at KM18, KM41, KM55 and KM68", "Two drop bags, KM41 and KM55", "Marshalled course with sweep and medical team", "Transport back to the start assembly", "Race insurance for the duration"],
    sched: [{ time: "01:00", label: "Bag drop and mandatory gear check opens" }, { time: "02:30", label: "Race briefing, 80K" }, { time: "03:00", label: "Gun start, 80K Traverse" }, { time: "05:00", label: "Gun start, 50K" }, { time: "15:00", label: "First 50K finishers expected" }, { time: "18:00", label: "First 80K finishers expected" }, { time: "09:00", label: "Course closes, 30-hour cut-off" }],
    addons: [["Traverse Finisher Jacket", 195000], ["Drop Bag Service, both points", 65000], ["Return Shuttle to Malaybalay", 50000], ["Race Photo Pack", 60000]],
  },
  {
    id: "00000000-0000-0000-0000-000000010006", org: A1, seed: 1007,
    start: [8.3179, 124.8534], finish: null, km: 36, gain: 1350, base: 1140, terrain: true,
    place: "Dahilayan, Manolo Fortich, Bukidnon",
    desc: "Thirty-six kilometres around the Dahilayan plateau at 1,200 metres, where the air is cold at the start and stays cool until noon. The course strings together pine plantation roads, the old zipline access trail, and a long grassy ridge with the Kitanglad range filling the whole southern horizon. Fast for a trail race — the climbs are steady rather than steep.",
    note: "Moved from 29 August after the Tagoloan bridge closure. Existing entries carry over automatically.",
    incl: ["Race bib with timing chip", "Finisher medal", "Technical race singlet", "Aid stations every 6 km", "Marshalled course with sweep team", "Baggage deposit at the adventure park", "Post-race meal and hot drinks"],
    sched: [{ time: "03:30", label: "Assembly and baggage deposit opens" }, { time: "04:45", label: "Race briefing" }, { time: "05:00", label: "Gun start, 36K Sky" }, { time: "06:00", label: "Gun start, 18K" }, { time: "09:00", label: "First 36K finishers expected" }, { time: "12:30", label: "Awarding" }, { time: "16:00", label: "Course closes" }],
    addons: [["Sky Race Finisher Jacket", 155000], ["Dahilayan Cabin, Race Eve", 120000], ["Race Photo Pack", 50000]],
  },
  {
    id: "00000000-0000-0000-0000-000000010007", org: A1, seed: 1008,
    start: [8.3178, 124.9702], finish: null, km: 30, gain: 1120, base: 460, terrain: true,
    place: "Sumilao, Bukidnon",
    desc: "A trail loop built around three waterfalls in the hills above Sumilao, with a swim-through section at the second one that nobody manages to stay dry for. The climbing is front-loaded: the first twelve kilometres take most of the day's 1,120 metres, and what follows is a long descent along the water. Shoes will get wet at KM9 and stay wet.",
    note: "Race kit claiming: 11–12 February at Sumilao Municipal Hall, 09:00–17:00. A dry bag is strongly recommended for the KM14 crossing.",
    incl: ["Race bib with timing chip", "Finisher medal", "Technical race singlet", "Aid stations every 6 km", "Marshalled course with water-safety team", "Baggage deposit and shower access", "Post-race meal"],
    sched: [{ time: "04:00", label: "Assembly and baggage deposit opens" }, { time: "05:15", label: "Race briefing" }, { time: "05:30", label: "Gun start, 30K" }, { time: "06:15", label: "Gun start, 15K" }, { time: "09:30", label: "First 30K finishers expected" }, { time: "13:00", label: "Awarding" }, { time: "15:00", label: "Course closes" }],
    addons: [["Falls Trail Finisher Tee", 65000], ["Dry Bag, 10L", 35000], ["Race Photo Pack", 45000]],
  },
  {
    id: "00000000-0000-0000-0000-000000010008", org: A1, seed: 1009,
    start: [7.7684, 125.0087], finish: null, km: 55, gain: 2400, base: 380, terrain: true,
    place: "Maramag, Bukidnon",
    desc: "Fifty-five kilometres out of Maramag town proper, climbing away from the valley floor onto the ridges that separate the Pulangi from the Muleta. Sugarcane roads for the first ten kilometres, then trail the rest of the way, with the long climb to the KM28 turnaround being the section every finisher remembers. The 25K shares the first half and turns at the ridge saddle.",
    note: "Cancelled. The Pulangi crossing is unsafe after the August flooding and no alternate line clears the cut-offs. Full refunds have been processed.",
    incl: ["Race bib with timing chip", "Finisher buckle", "Technical race singlet", "Aid stations every 7 km", "Drop bag at KM28", "Marshalled course with sweep and medical team", "Post-race meal at Maramag town proper"],
    sched: [{ time: "02:30", label: "Assembly and gear check opens" }, { time: "03:40", label: "Race briefing" }, { time: "04:00", label: "Gun start, 55K Valley" }, { time: "05:30", label: "Gun start, 25K" }, { time: "12:00", label: "First 55K finishers expected" }, { time: "17:00", label: "Awarding" }, { time: "00:00", label: "Course closes, 20-hour cut-off" }],
    addons: [["Valley Ultra Finisher Jacket", 150000], ["Drop Bag Service, KM28", 45000], ["Race Photo Pack", 50000]],
  },
  {
    id: "00000000-0000-0000-0000-000000010009", org: A1, seed: 1010,
    start: [7.9074, 125.0906], finish: null, km: 45, gain: 2050, base: 320, terrain: true,
    place: "City of Valencia, Bukidnon",
    desc: "Two summits, one loop, forty-five kilometres. The course leaves the Valencia sports complex before dawn, climbs the first peak by the old logging road, drops the whole way back to the valley, and then does it again on the second. The double descent breaks more quads than the climbing does. The 20K takes the first peak only.",
    note: "Results and finisher photos are posted. Unclaimed finisher packages may be picked up at the Muspo office until the end of the month.",
    incl: ["Race bib with timing chip", "Finisher medal", "Technical race singlet", "Aid stations every 6 km", "Marshalled course with sweep team", "Baggage deposit and shower access", "Post-race meal at the sports complex"],
    sched: [{ time: "03:00", label: "Assembly and baggage deposit opens" }, { time: "04:15", label: "Race briefing" }, { time: "04:30", label: "Gun start, 45K Twin Peaks" }, { time: "05:30", label: "Gun start, 20K" }, { time: "10:30", label: "First 45K finishers expected" }, { time: "15:00", label: "Awarding" }, { time: "20:30", label: "Course closes" }],
    addons: [["Event Singlet", 60000], ["Finisher Package", 120000], ["Race Photo Pack", 45000]],
  },

  {
    id: "00000000-0000-0000-0000-000000020000", org: A2, seed: 2001,
    start: [7.7366, 125.0987], finish: null, km: 21, gain: 60, base: 300, terrain: false,
    place: "Quezon, Bukidnon",
    desc: "Flat, fast, and entirely along the Pulangi. The course runs the riverside road out of Quezon town, turns at the irrigation weir, and comes back the same way with the current. Sixty metres of gain across the whole half marathon — this is where Bukidnon road runners come to set a personal best. Three distances share the start arch and the first two kilometres.",
    note: "Race kit claiming: 24–25 September at Pulangi Riverside Park, 10:00–19:00. Late claiming on race morning from 04:00.",
    incl: ["Race bib with timing chip", "Finisher medal", "Dri-fit race shirt", "Hydration stations every 2.5 km", "Marshalled and closed course", "Baggage deposit", "Post-race meal and fruit", "Race insurance for the duration"],
    sched: [{ time: "03:30", label: "Baggage deposit and late claiming opens" }, { time: "04:45", label: "Warm-up" }, { time: "05:00", label: "Gun start, 21K" }, { time: "05:30", label: "Gun start, 10K" }, { time: "06:00", label: "Gun start, 5K" }, { time: "06:20", label: "First 21K finishers expected" }, { time: "08:30", label: "Awarding" }, { time: "11:00", label: "Course closes" }],
    addons: [["Pulangi Finisher Tee", 55000], ["Extra Race Bib Belt", 25000], ["Race Photo Pack", 40000]],
  },
  {
    id: "00000000-0000-0000-0000-000000020001", org: A2, seed: 2002,
    start: [8.1571, 125.1281], finish: null, km: 42, gain: 320, base: 610, terrain: false,
    place: "Kaamulan Grounds, Malaybalay, Bukidnon",
    desc: "The full marathon through the capital, on a certified loop that starts and finishes at the Kaamulan Grounds and takes in the cathedral, the provincial capitol, and eleven kilometres of the national highway closed to traffic for the morning. At 600 metres of altitude the air is cool and thin enough to be worth the trip from the coast. Pacers at 3:30, 4:00, 4:30 and 5:00.",
    note: "Race kit claiming: 11–12 December at the Kaamulan Grounds pavilion, 10:00–20:00. No race-day claiming for the 42K.",
    incl: ["Race bib with timing chip", "Finisher medal and certificate", "Dri-fit race shirt", "Hydration and sponge stations every 2.5 km", "Certified and marshalled closed course", "Official pacers on the 42K", "Baggage deposit and shower access", "Post-race meal", "Race insurance for the duration"],
    sched: [{ time: "02:30", label: "Baggage deposit opens" }, { time: "03:45", label: "Warm-up and corral assembly" }, { time: "04:00", label: "Gun start, 42K Full Marathon" }, { time: "04:30", label: "Gun start, 21K Half" }, { time: "05:30", label: "Gun start, 10K" }, { time: "06:45", label: "First 42K finishers expected" }, { time: "10:00", label: "Awarding" }, { time: "11:00", label: "Course closes" }],
    addons: [["Marathon Finisher Jacket", 135000], ["Pace Band and Bib Belt", 30000], ["Race Photo Pack", 45000], ["Post-race Massage Slot", 40000]],
  },
  {
    id: "00000000-0000-0000-0000-000000020002", org: A2, seed: 2003,
    start: [7.9058, 125.0942], finish: null, km: 21, gain: 180, base: 310, terrain: false,
    place: "City of Valencia, Bukidnon",
    desc: "A half marathon on rolling city roads, out from Valencia City Hall through the barangay ring road and back along the highway. The only real climb is the long drag at KM14 that decides everybody's finishing time. Closed course throughout, with the 10K sharing the first five kilometres before turning at the public market.",
    note: "Race kit claiming: 9–10 October at Valencia City Hall lobby, 09:00–18:00.",
    incl: ["Race bib with timing chip", "Finisher medal", "Dri-fit race shirt", "Hydration stations every 2.5 km", "Marshalled and closed course", "Baggage deposit", "Post-race meal and fruit", "Race insurance for the duration"],
    sched: [{ time: "03:00", label: "Baggage deposit opens" }, { time: "04:15", label: "Warm-up" }, { time: "04:30", label: "Gun start, 21K Half" }, { time: "05:00", label: "Gun start, 10K" }, { time: "05:50", label: "First 21K finishers expected" }, { time: "08:00", label: "Awarding" }, { time: "08:30", label: "Course closes" }],
    addons: [["Half Marathon Finisher Tee", 60000], ["Race Photo Pack", 40000], ["Post-race Massage Slot", 35000]],
  },
  {
    id: "00000000-0000-0000-0000-000000020003", org: A2, seed: 2004,
    start: [7.6815, 125.0011], finish: null, km: 10, gain: 40, base: 330, terrain: false,
    place: "Don Carlos, Bukidnon",
    desc: "The biggest fun run in southern Bukidnon and the one race on the calendar where the 3K field outnumbers everything else combined. Flat loops out of the municipal oval through the town proper, closed to traffic from four in the morning, with a brass band at the turnaround and the whole barangay out on the road. Strollers and leashed dogs welcome in the 3K.",
    note: "Race kit claiming: 13–14 November at the Don Carlos Municipal Oval, 08:00–18:00. Race-day claiming from 04:30 for the 3K only.",
    incl: ["Race bib", "Finisher medal for all distances", "Cotton race shirt", "Hydration stations every 2 km", "Marshalled and closed course", "Baggage deposit", "Post-race snack and drink", "Race insurance for the duration"],
    sched: [{ time: "04:00", label: "Baggage deposit and late claiming opens" }, { time: "05:15", label: "Zumba warm-up" }, { time: "05:30", label: "Gun start, 10K" }, { time: "06:00", label: "Gun start, 5K" }, { time: "06:30", label: "Gun start, 3K Family" }, { time: "07:30", label: "Raffle draw" }, { time: "08:30", label: "Awarding" }, { time: "09:00", label: "Course closes" }],
    addons: [["Family Finisher Tee", 45000], ["Extra Raffle Entry", 10000], ["Race Photo Pack", 30000]],
  },
  {
    id: "00000000-0000-0000-0000-000000020004", org: A2, seed: 2005,
    start: [8.3986, 124.7318], finish: null, km: 15, gain: 110, base: 590, terrain: false,
    place: "Libona, Bukidnon",
    desc: "An early start out of the Libona plaza, on quiet upland roads with the lights of Cagayan de Oro visible on the plain below for the first hour. The course rolls gently through pineapple country and finishes back in the plaza as the market is opening. Cool, quiet, and the fastest 18K in the province.",
    note: "Race kit claiming: 8–9 January at Libona Municipal Plaza, 09:00–17:00.",
    incl: ["Race bib with timing chip", "Finisher medal", "Dri-fit race shirt", "Hydration stations every 3 km", "Marshalled course with lead and sweep vehicles", "Baggage deposit", "Post-race meal", "Race insurance for the duration"],
    sched: [{ time: "03:30", label: "Baggage deposit opens" }, { time: "04:45", label: "Warm-up" }, { time: "05:00", label: "Gun start, 18K" }, { time: "05:30", label: "Gun start, 10K" }, { time: "06:00", label: "Gun start, 5K" }, { time: "06:15", label: "First 18K finishers expected" }, { time: "08:00", label: "Awarding" }, { time: "09:00", label: "Course closes" }],
    addons: [["Dawn Dash Finisher Tee", 50000], ["Race Photo Pack", 35000]],
  },
  {
    id: "00000000-0000-0000-0000-000000020005", org: A2, seed: 2006,
    start: [7.7635, 125.0031], finish: null, km: 16, gain: 90, base: 350, terrain: false,
    place: "Maramag, Bukidnon",
    desc: "A night race through Maramag with the whole town proper lit and closed to traffic. The course runs four kilometres out along the highway and back, twice for the 16K, with sound systems at both turnarounds and glow markers the entire way. Headlamps are not required — the course is lit — but a blinker is mandatory.",
    note: "Flag-off has passed. The course stays live until the 06:00 sweep.",
    incl: ["Race bib with timing chip", "LED blinker and glow band", "Finisher medal", "Dri-fit race shirt", "Hydration stations every 2 km", "Fully lit and marshalled closed course", "Baggage deposit", "Post-race meal"],
    sched: [{ time: "17:00", label: "Baggage deposit and late claiming opens" }, { time: "18:30", label: "Warm-up and briefing" }, { time: "19:00", label: "Gun start, 16K Night" }, { time: "19:30", label: "Gun start, 8K Night" }, { time: "20:10", label: "First 16K finishers expected" }, { time: "22:00", label: "Awarding" }, { time: "00:00", label: "Course closes" }],
    addons: [["Night Run Finisher Tee", 55000], ["Extra LED Armband", 15000], ["Race Photo Pack", 35000]],
  },
  {
    id: "00000000-0000-0000-0000-000000020006", org: A2, seed: 2007,
    start: [7.7513, 124.7521], finish: null, km: 18, gain: 140, base: 500, terrain: false,
    place: "Kalilangan, Bukidnon",
    desc: "A single big loop out of Kalilangan municipal hall through four barangays and back, on concrete roads the whole way. Gently rolling with one steady climb at KM11 through the corn fields, and a long downhill finish that flatters everybody's split. The 9K runs the same loop cut in half.",
    note: "Moved from 19 September to avoid a clash with the municipal fiesta. Entries carry over.",
    incl: ["Race bib with timing chip", "Finisher medal", "Dri-fit race shirt", "Hydration stations every 3 km", "Marshalled course with lead and sweep vehicles", "Baggage deposit", "Post-race meal", "Race insurance for the duration"],
    sched: [{ time: "03:30", label: "Baggage deposit opens" }, { time: "04:45", label: "Warm-up" }, { time: "05:00", label: "Gun start, 18K Loop" }, { time: "05:30", label: "Gun start, 9K" }, { time: "06:15", label: "First 18K finishers expected" }, { time: "08:00", label: "Awarding" }, { time: "10:00", label: "Course closes" }],
    addons: [["Loop Run Finisher Tee", 50000], ["Race Photo Pack", 35000]],
  },
  {
    id: "00000000-0000-0000-0000-000000020007", org: A2, seed: 2008,
    start: [7.5674, 125.0004], finish: null, km: 10, gain: 50, base: 340, terrain: false,
    place: "Kibawe, Bukidnon",
    desc: "A barangay fun run in the truest sense — the course is the road between Kibawe town plaza and the next four barangays, and most of those barangays are standing on it. Flat, short, and organised so that a family can enter together and finish together. The 10K is a double loop for the runners who want a time.",
    note: "Race kit claiming: 29–30 January at Kibawe Town Plaza, 08:00–17:00. Race-day claiming from 04:30.",
    incl: ["Race bib", "Finisher medal for all distances", "Cotton race shirt", "Hydration stations every 2 km", "Marshalled and closed course", "Baggage deposit", "Post-race snack and drink"],
    sched: [{ time: "04:15", label: "Baggage deposit and late claiming opens" }, { time: "05:15", label: "Zumba warm-up" }, { time: "05:30", label: "Gun start, 10K" }, { time: "06:00", label: "Gun start, 5K" }, { time: "07:00", label: "Raffle draw" }, { time: "08:00", label: "Awarding" }, { time: "08:30", label: "Course closes" }],
    addons: [["Barangay Run Tee", 40000], ["Extra Raffle Entry", 10000]],
  },
  {
    id: "00000000-0000-0000-0000-000000020008", org: A2, seed: 2009,
    start: [7.9172, 125.3341], finish: null, km: 12, gain: 70, base: 410, terrain: false,
    place: "San Fernando, Bukidnon",
    desc: "Twelve kilometres along the river road east of San Fernando, out to the hanging bridge and back. Shaded for most of the distance and flat enough that the only thing standing between a runner and a personal best is the humidity coming off the water. The 6K turns at the barangay hall.",
    note: "Cancelled. The riverside road remains closed for repair with no safe detour. Full refunds have been processed.",
    incl: ["Race bib with timing chip", "Finisher medal", "Dri-fit race shirt", "Hydration stations every 2 km", "Marshalled course with lead and sweep vehicles", "Baggage deposit", "Post-race meal"],
    sched: [{ time: "03:45", label: "Baggage deposit opens" }, { time: "04:45", label: "Warm-up" }, { time: "05:00", label: "Gun start, 12K" }, { time: "05:30", label: "Gun start, 6K" }, { time: "05:50", label: "First 12K finishers expected" }, { time: "07:30", label: "Awarding" }, { time: "09:00", label: "Course closes" }],
    addons: [["River Dash Finisher Tee", 45000], ["Race Photo Pack", 30000]],
  },
  {
    id: "00000000-0000-0000-0000-000000020009", org: A2, seed: 2010,
    start: [8.3164, 124.7327], finish: null, km: 10, gain: 60, base: 300, terrain: false,
    place: "Baungon, Bukidnon",
    desc: "A sunrise 10K out of the Baungon municipal oval, run east so the whole field faces the light coming up over the Kitanglad range at about the four-kilometre mark. Flat, closed, and finished before seven. The 5K shares the course and turns at the school.",
    note: "Results and finisher photos are posted. Unclaimed finisher shirts may be picked up at the municipal oval until the end of the month.",
    incl: ["Race bib with timing chip", "Finisher medal", "Dri-fit race shirt", "Hydration stations every 2 km", "Marshalled and closed course", "Baggage deposit", "Post-race meal and coffee"],
    sched: [{ time: "03:45", label: "Baggage deposit and late claiming opens" }, { time: "04:45", label: "Warm-up" }, { time: "05:00", label: "Gun start, 10K" }, { time: "05:20", label: "Gun start, 5K" }, { time: "05:35", label: "First 10K finishers expected" }, { time: "07:00", label: "Awarding" }, { time: "08:00", label: "Course closes" }],
    addons: [["Sunrise Finisher Tee", 45000], ["Race Photo Pack", 30000]],
  },
];

// ── Per-distance blurbs, keyed by category id ────────────────────────────────
const BLURBS = {
  // Valencia Twin Peaks
  "c2ff88fe-3b5b-44ee-a0c8-a250e0b86e20": "Both summits and both descents. The quad-breaker.",
  "801b87cf-14e0-4267-a90b-277458677932": "The first peak only, back down the same road.",
  // Baungon Sunrise 10K
  "174e5abf-14f3-485a-bcce-6127ae88d0e5": "Flat, closed, and finished before seven.",
  "d14b99e9-2515-4c77-998f-ff2312409ab6": "Turns at the school. Good for a first race.",
  // Kalatungan Traverse
  "212ec2a2-6b15-46d5-99ac-9bf8d1bbb230": "Point to point across the whole range.",
  "a947f498-1264-46c1-b83f-e2b8ee5b80f4": "Joins the traverse at the KM30 saddle.",
  // Maramag Night Run
  "5c3f79fe-1710-4ede-be30-6b7222bc5c08": "Two laps of the lit highway loop.",
  "38d68f51-1a36-4696-ab97-df53c3f5452f": "One lap. Home before the awarding.",
  // Kitanglad Skyline Ultra
  "4f21374b-a4d2-4aa7-a4e4-e48ff661817b": "The full Kitanglad ridge. Qualifier required.",
  "cdbed83e-d2d9-467a-800e-45c520aacc16": "Half the ridge, all of the climb.",
  "f5ddcc4b-71c4-4c77-a66f-a5f56ce8b5fd": "The introduction to Kitanglad.",
  // Dulang-Dulang Vertical
  "f84c5516-3172-4573-b40c-44eaffc6f7f9": "Straight up the second-highest peak in the country.",
  "e4f8045c-6842-413e-89cd-819cfca6356a": "Turns below the mossy forest. Still all climb.",
  // Pulangi River Run
  "5291d76d-66d2-46ec-8859-4d81eb8263ab": "Flat and fast along the Pulangi.",
  "d36bf2ad-8486-4d5e-968f-dc6737cf2c8e": "Out to the weir and back with the current.",
  "267de10a-266e-454a-ae3f-3beae97789b0": "Two and a half kilometres out, then home.",
  // Maramag Valley Ultra
  "ad53b14c-713c-44c1-a4a7-42c30ce20179": "Cane roads out, ridge trail back.",
  "e7ff278f-1878-474f-90d4-bdd5aad1c4de": "Turns at the ridge saddle above the valley.",
  // Valencia Half Marathon
  "eca76d2c-badf-483d-876e-760c4a536a9a": "Rolling city roads with one long drag at KM14.",
  "c51fd967-bba7-4a30-953b-126b2d8d235f": "Turns at the public market. Closed the whole way.",
  // Malaybalay Highland Trail
  "fd76243e-58d7-4e88-aa09-8c8e49162519": "Pine, two river fords, and the ridge road home.",
  "9fa632e0-3d79-4caf-8810-9a374870061e": "One ford, one climb, one long descent.",
  "ee9e63ad-1cfb-4c6b-aa42-5f733619eaee": "First trail? Start here.",
  // Don Carlos Fun Run
  "0db8cf99-bdf2-4e2c-acf5-f0a0fd9fcd3d": "Two laps of the town proper for a real time.",
  "47f7ba20-f20d-4a05-a8f2-cdcc5505f013": "One lap, band at the turnaround.",
  "67dd70bd-ab71-46e6-ad13-88f12fe7f628": "Bring the whole family.",
  // Manolo Fortich Sky Race
  "bb0e1c5b-802f-44c9-b818-71d6d98c592d": "The full plateau loop at 1,200 metres.",
  "db69605a-d486-485a-9d15-2c4c0821390c": "Pine roads and the grassy ridge, no zipline trail.",
  // San Fernando River Dash
  "be44101d-e592-4ebe-84d9-e48025ccd6d0": "Out to the hanging bridge and back.",
  "4c4700c7-dd6b-4f36-963a-5e069e1166f0": "Turns at the barangay hall. Shaded throughout.",
  // Impasugong Ridge Run
  "845cf107-e2f8-421e-985f-e73be3ecc5c7": "Eleven climbs, none of them long, all of them there.",
  "a3e8b493-47a5-46dd-9dad-94708b76dbb8": "The northern ridges above the Tagoloan.",
  "126ff515-c1c2-459f-afc9-8941d3ea8cf6": "Cattle trail and logging road. A gentle first ridge.",
  // Malaybalay City Marathon
  "2752a007-475a-4e36-b3f7-26cf09d5fb80": "Certified loop through the city. Pacers on course.",
  "3f06df55-c9b6-4d0d-aa3a-b53abfceb3ee": "Cathedral, capitol, and eleven closed kilometres.",
  "14513b0a-e837-45bf-bb92-e6e44f2822a5": "The city loop, short version. Closed roads.",
  // Kalilangan Loop Run
  "e3f3649c-023a-490a-baa0-96ef639bb3ee": "One big loop through four barangays.",
  "f28ff0ed-883d-4cf6-a5fe-95e5ca293f3a": "The loop cut in half at the corn fields.",
  // Kibawe Barangay Run
  "1212a6c0-0538-4b8f-a218-1bfe652673a6": "Two laps for the runners who want a time.",
  "85ace5e1-99a6-451b-b397-ceafa9291547": "One lap out to the fourth barangay and back.",
  // Libona Dawn Dash
  "89f255e9-1e58-4057-bff4-d920f73e398a": "Upland roads with the city lights below.",
  "5f9d181a-4fe4-49aa-95bd-f0e7c011d35f": "Through pineapple country and home.",
  "daf66cb5-c613-4780-9a99-c8d2b33133d5": "Around the plaza loop. Walkers welcome.",
  // Sumilao Falls Trail
  "27384e43-0789-404f-8033-4abecdf0bb21": "Three waterfalls, one swim-through, wet shoes.",
  "b2fd4408-5753-4006-932b-1775c70b8a47": "Turns at the second falls. Front-loaded climbing.",
  // Talakag Forest Loop
  "d7fb969d-5610-4b56-b864-e0f7ad956d3c": "Under canopy the whole way, four creek crossings.",
  "a3779489-d756-4fc0-87ff-c3479c0246fd": "The short loop. Soft footing, short climbs.",
};

// ── Emit ────────────────────────────────────────────────────────────────────
const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const arr = (a) => `array[${a.map(q).join(",")}]::text[]`;
const json = (v) => `${q(JSON.stringify(v))}::jsonb`;

const out = [];
out.push(`-- Generated by scripts/seed-demo/gen-content.mjs — do not hand-edit.
-- Fills every remaining empty column on events and categories, and gives every
-- event add-ons and custom registration questions.
begin;

-- The event trigger fans a notification out to every registered runner on any
-- date/status change. Bulk-editing twenty events would generate thousands of
-- "your race moved" notices for edits that are not real reschedules.
alter table events disable trigger trg_events_notify;
`);

for (const [i, ev] of EVENTS.entries()) {
  const route = buildRoute(ev);
  const finish = ev.finish ?? ev.start;
  const km = lengthKm(route).toFixed(1);
  let up = 0;
  for (let j = 1; j < route.length; j++) up += Math.max(0, route[j][2] - route[j - 1][2]);
  out.push(`-- ${ev.place} — route fitted to ${km} km / ${Math.round(up)} m gain over ${route.length} points`);
  out.push(`update events set
  description = ${q(ev.desc)},
  status_note = ${q(ev.note)},
  place       = ${q(ev.place)},
  region      = 'Northern Mindanao',
  gallery     = ${arr(gallery(ev.org, i))},
  inclusions  = ${arr(ev.incl)},
  schedule    = ${json(ev.sched)},
  start_lat   = ${ev.start[0]}, start_lng  = ${ev.start[1]},
  finish_lat  = ${finish[0]},   finish_lng = ${finish[1]},
  route       = ${json(route)}
where id = '${ev.id}';
`);
}

out.push(`\n-- Per-distance blurbs. Elevation and cut-off are already set on every row.`);
for (const [id, blurb] of Object.entries(BLURBS)) {
  out.push(`update categories set blurb = ${q(blurb)} where id = '${id}';`);
}

out.push(`
-- Add-ons. Every seeded add-on carries the all-zero id prefix, so clearing that
-- range first makes the script re-runnable without stacking duplicates. Safe
-- only BEFORE registrations exist — registration_addons references these rows.
delete from addons where id::text like '00000000-0000-0000-0000-%';`);
for (const ev of EVENTS) {
  const short = ev.id.slice(-6);
  ev.addons.forEach(([name, price], j) => {
    const id = `00000000-0000-0000-0000-adad${short}${String(j).padStart(2, "0")}`;
    out.push(`insert into addons (id, org_id, event_id, name, price) values ('${id}','${ev.org}','${ev.id}',${q(name)},${price})
  on conflict (id) do update set name = excluded.name, price = excluded.price;`);
  });
}

out.push(`
-- Custom registration questions. Every event gets the same core set (the fields
-- an organizer actually needs on race day) plus one event-specific question, so
-- the wizard renders a populated form for any race a runner picks.`);
const CORE = [
  { key: "blood_type", label: "Blood type", type: "select", req: true, opts: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
  { key: "shirt_size", label: "Shirt size", type: "select", req: true, opts: ["XS", "S", "M", "L", "XL", "XXL"] },
  { key: "running_club", label: "Running club", type: "text", req: false, opts: null },
  { key: "emergency_relation", label: "Relationship to emergency contact", type: "text", req: true, opts: null },
];
const EXTRA = {
  "00000000-0000-0000-0000-000000010000": { key: "qualifier_race", label: "Qualifying race and finish time (65K only)", type: "text", req: false, opts: null },
  "00000000-0000-0000-0000-000000010001": { key: "poles", label: "Bringing trekking poles", type: "checkbox", req: false, opts: null },
  "00000000-0000-0000-0000-000000010002": { key: "first_trail", label: "This is my first trail race", type: "checkbox", req: false, opts: null },
  "00000000-0000-0000-0000-000000010003": { key: "hydration_type", label: "Hydration setup", type: "select", req: false, opts: ["Vest", "Belt", "Handheld", "Cups only"] },
  "00000000-0000-0000-0000-000000010004": { key: "first_trail", label: "This is my first trail race", type: "checkbox", req: false, opts: null },
  "00000000-0000-0000-0000-000000010005": { key: "drop_bag_points", label: "Drop bag points needed", type: "select", req: true, opts: ["KM41 only", "KM55 only", "Both", "None"] },
  "00000000-0000-0000-0000-000000010006": { key: "cabin_share", label: "Cabin sharing preference", type: "text", req: false, opts: null },
  "00000000-0000-0000-0000-000000010007": { key: "swim_confident", label: "Comfortable with the KM14 water crossing", type: "checkbox", req: true, opts: null },
  "00000000-0000-0000-0000-000000010008": { key: "drop_bag", label: "Using the KM28 drop bag", type: "checkbox", req: false, opts: null },
  "00000000-0000-0000-0000-000000010009": { key: "singlet_size", label: "Event singlet size", type: "select", req: false, opts: ["S", "M", "L", "XL"] },
  "00000000-0000-0000-0000-000000020000": { key: "target_time", label: "Target finish time", type: "text", req: false, opts: null },
  "00000000-0000-0000-0000-000000020001": { key: "pace_group", label: "Pace group", type: "select", req: false, opts: ["3:30", "4:00", "4:30", "5:00", "No pacer"] },
  "00000000-0000-0000-0000-000000020002": { key: "target_time", label: "Target finish time", type: "text", req: false, opts: null },
  "00000000-0000-0000-0000-000000020003": { key: "group_name", label: "Family or group name", type: "text", req: false, opts: null },
  "00000000-0000-0000-0000-000000020004": { key: "shuttle_pickup", label: "Shuttle pick-up point", type: "select", req: false, opts: ["Libona plaza", "Manolo Fortich junction", "Not using the shuttle"] },
  "00000000-0000-0000-0000-000000020005": { key: "blinker", label: "Bringing my own blinker", type: "checkbox", req: false, opts: null },
  "00000000-0000-0000-0000-000000020006": { key: "barangay", label: "Home barangay", type: "text", req: false, opts: null },
  "00000000-0000-0000-0000-000000020007": { key: "group_name", label: "Family or group name", type: "text", req: false, opts: null },
  "00000000-0000-0000-0000-000000020008": { key: "target_time", label: "Target finish time", type: "text", req: false, opts: null },
  "00000000-0000-0000-0000-000000020009": { key: "first_race", label: "This is my first road race", type: "checkbox", req: false, opts: null },
};
for (const ev of EVENTS) {
  const fields = [...CORE, EXTRA[ev.id]];
  fields.forEach((f, j) => {
    const opts = f.opts ? arr(f.opts) : "null";
    out.push(`insert into form_fields (org_id, event_id, key, label, type, required, options, sort_order)
  values ('${ev.org}','${ev.id}',${q(f.key)},${q(f.label)},'${f.type}',${f.req},${opts},${j + 1})
  on conflict (event_id, key) do update set
    label = excluded.label, type = excluded.type, required = excluded.required,
    options = excluded.options, sort_order = excluded.sort_order, is_active = true;`);
  });
}

out.push(`
alter table events enable trigger trg_events_notify;
commit;`);

writeFileSync(OUT, out.join("\n") + "\n");
console.error(`wrote ${OUT}`);
