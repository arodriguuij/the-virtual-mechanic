// Real commercial nutrition products — unlike `lib/metabolic-engine.ts`'s
// own pocket-food catalog (illustrative, fixed carb-only figures for a
// generic "banana"/"energy bar"), these are genuine SKUs from real brands,
// each carrying its own real sodium figure too (several catalog items
// legitimately carry `0` — Precision Fuel's gels are deliberately
// electrolyte-free, since that brand sells sodium separately as capsules —
// so `0` here is real label data, not a missing value). Pure data, no
// logic — `components/fueling-planner.tsx`'s Card 04 "Marcas comerciales"
// selector is the one consumer.
export interface CommercialProduct {
  id: string;
  brand: string;
  name: string;
  category: "gel" | "mix" | "bar" | "chew";
  carbs: number; // en gramos (HC)
  sodium: number; // en miligramos (Na+)
}

export const COMMERCIAL_PRODUCTS: CommercialProduct[] = [
  // Maurten
  { id: "maurten-gel-100", brand: "Maurten", name: "Gel 100", category: "gel", carbs: 25, sodium: 20 },
  {
    id: "maurten-mix-320",
    brand: "Maurten",
    name: "Drink Mix 320",
    category: "mix",
    carbs: 80,
    sodium: 500,
  },

  // 226ERS
  {
    id: "226ers-high-fructose",
    brand: "226ERS",
    name: "High Fructose Gel",
    category: "gel",
    carbs: 55,
    sodium: 250,
  },
  {
    id: "226ers-high-energy",
    brand: "226ERS",
    name: "High Energy Gel",
    category: "gel",
    carbs: 50,
    sodium: 100,
  },

  // SiS (Science in Sport)
  { id: "sis-beta-fuel-gel", brand: "SiS", name: "Beta Fuel Gel", category: "gel", carbs: 40, sodium: 30 },
  {
    id: "sis-beta-fuel-mix",
    brand: "SiS",
    name: "Beta Fuel Drink Mix",
    category: "mix",
    carbs: 80,
    sodium: 570,
  },

  // Santa Madre
  {
    id: "santa-madre-60cho",
    brand: "Santa Madre",
    name: "Unusual Gel 60CHO",
    category: "gel",
    carbs: 60,
    sodium: 200,
  },
  {
    id: "santa-madre-90cho",
    brand: "Santa Madre",
    name: "Unusual Drink 90CHO",
    category: "mix",
    carbs: 90,
    sodium: 500,
  },

  // Neversecond
  {
    id: "neversecond-c30-gel",
    brand: "Neversecond",
    name: "C30 Energy Gel",
    category: "gel",
    carbs: 30,
    sodium: 200,
  },
  {
    id: "neversecond-c90-mix",
    brand: "Neversecond",
    name: "C90 High Carb Mix",
    category: "mix",
    carbs: 90,
    sodium: 200,
  },

  // Precision Fuel
  { id: "pf-30-gel", brand: "Precision Fuel", name: "PF 30 Gel", category: "gel", carbs: 30, sodium: 0 },
  {
    id: "pf-90-gel",
    brand: "Precision Fuel",
    name: "PF 90 Gel (XL)",
    category: "gel",
    carbs: 90,
    sodium: 0,
  },
];
