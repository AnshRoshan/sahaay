// Deterministic demo dataset: a small garment shop, ~120 days of history.
// Includes deliberate edge cases (missing lead time, negative stock, conflicting supplier
// rows, brand-new product, invalid dates, duplicates) so every safety path is demonstrable.
import { toCsv } from "./csv";
import { addDays, todayStr, weekdayOf } from "./dates";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function poisson(lambda: number, r: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-Math.min(lambda, 30));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L && k < 60);
  return k - 1;
}

export const WEEKDAY_DEMAND = [1.35, 0.85, 0.85, 0.9, 0.95, 1.1, 1.4]; // Sun..Sat

type Offer = [supplier: string, price: number, lead: number | null, moq: number | null];
type Spec = {
  id: string; name: string; category: string; cost: number; sell: number;
  base: number; trend: number; stock: number | null; offers: Offer[];
  launchDaysAgo?: number; stockoutWindows?: [number, number][];
};

export const SUPPLIERS: Record<string, string> = {
  A: "Anand Textiles", B: "Bharat Garments", C: "Chandni Fabrics", D: "Delhi Denim Co",
  E: "Eastern Knits", F: "Fashion Hub Ethnic", G: "Gupta Accessories",
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const round5 = (x: number) => Math.round(x / 5) * 5;

function buildSpecs(): Spec[] {
  const r = rng(42);
  const specs: Spec[] = [];
  const fam = (
    names: [string, string[]][], category: string, cost: number, sell: number, sup: string, lead: number, withB: boolean,
  ) => {
    for (const [n, sizes] of names)
      for (const sz of sizes) {
        const name = `${n} ${sz}`;
        const c = round5(cost * (0.9 + r() * 0.25));
        const base = 0.35 + r() * 1.3;
        const offers: Offer[] = [[sup, c, lead + Math.floor(r() * 2), 10]];
        if (withB) offers.push(["B", round5(c * 0.93), 8 + Math.floor(r() * 3), 25]);
        specs.push({
          id: slug(name), name, category, cost: c, sell: Math.round((sell * c) / cost / 10) * 10 - 1,
          base, trend: (r() - 0.5) * 0.2, stock: Math.round(base * (8 + r() * 30)), offers,
        });
      }
  };
  fam([["Blue Shirt", ["S", "M", "L"]], ["White Shirt", ["M", "L"]], ["Checked Shirt", ["M", "L"]]], "Shirts", 420, 799, "A", 5, true);
  fam([["Black Jeans", ["32", "34"]], ["Blue Jeans", ["32", "34"]], ["Grey Jeans", ["32"]]], "Jeans", 780, 1399, "D", 6, true);
  fam([["Polo Tee", ["M", "L"]], ["Round Neck Tee", ["M", "L"]]], "T-Shirts", 210, 449, "E", 4, true);
  fam([["Linen Kurta", ["M", "L"]], ["Cotton Kurta", ["M"]]], "Ethnic", 520, 999, "F", 7, false);
  fam([["Formal Trouser", ["32", "34"]], ["Chino", ["32"]]], "Trousers", 560, 1099, "A", 5, true);
  fam([["Cotton Socks 3-pack", ["Free"]], ["Canvas Cap", ["Free"]], ["Leather Belt", ["Free"]], ["Leather Wallet", ["Free"]]], "Accessories", 120, 299, "G", 3, false);
  fam([["Track Pant", ["L"]], ["Cargo Shorts", ["M"]], ["Rain Jacket", ["L"]], ["Sweatshirt", ["L"]]], "Casual", 340, 699, "C", 5, false);

  const set = (id: string, patch: Partial<Spec>) => {
    const s = specs.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
  };
  // Hero: rising demand, low stock, cheaper alternative supplier
  set("blue-shirt-m", {
    base: 1.35, trend: 0.45, stock: 7,
    offers: [["A", 420, 6, 10], ["B", 390, 9, 25]],
    stockoutWindows: [[18, 21], [41, 44], [66, 69]],
  });
  // Declining demand, large stock
  set("black-jeans-32", { base: 1.5, trend: -0.55, stock: 64, offers: [["D", 780, 6, 10], ["B", 725, 9, 25]] });
  // Missing lead time → must abstain
  set("rain-jacket-l", { base: 0.9, trend: 0, stock: 5, offers: [["C", 640, null, 12]] });
  // Negative inventory → data error
  set("sweatshirt-l", { base: 0.8, trend: 0, stock: -3 });
  // Conflicting supplier rows → flag conflict
  set("linen-kurta-m", { base: 1.2, trend: 0.1, stock: 8, offers: [["F", 455, 7, 10], ["F", 470, 9, 10], ["C", 440, 8, 20]] });
  // No supplier information on a few products
  for (const id of ["leather-belt-free", "leather-wallet-free", "canvas-cap-free"]) set(id, { offers: [] });
  // Brand-new product → low confidence
  specs.push({
    id: "silk-scarf-free", name: "Silk Scarf Free", category: "Accessories", cost: 260, sell: 599,
    base: 0.9, trend: 0, stock: 4, offers: [["G", 260, 5, 6]], launchDaysAgo: 12,
  });
  return specs;
}

export const DEMO_SPECS = buildSpecs();

export type DemoBundle = {
  products: string; inventory: string; suppliers: string; sales: string;
  meta: { products: number; salesRows: number; suppliers: number; asOf: string };
};

export function generateDemoCsvs(today = todayStr()): DemoBundle {
  const r = rng(7);
  const asOf = addDays(today, -1);
  const DAYS = 120;
  const salesRows: (string | number | null)[][] = [];

  for (const s of DEMO_SPECS) {
    for (let i = 0; i < DAYS; i++) {
      const date = addDays(asOf, -(DAYS - 1 - i));
      if (s.launchDaysAgo !== undefined && DAYS - 1 - i >= s.launchDaysAgo) continue;
      if (s.stockoutWindows?.some(([a, b]) => i >= a && i <= b)) continue;
      const ramp = Math.max(0, Math.min(1, (i - (DAYS - 36)) / 36));
      const lam = s.base * (1 + s.trend * ramp) * WEEKDAY_DEMAND[weekdayOf(date)] * (0.85 + 0.3 * r());
      let c = poisson(lam, r);
      while (c > 0) {
        const q = c >= 2 && r() < 0.2 ? 2 : 1;
        const price = r() < 0.1 ? Math.round(s.sell * 0.9) : s.sell;
        salesRows.push([date, s.id, q, price]);
        c -= q;
      }
    }
  }
  // Realistic mess: invalid dates, a typo'd product id, exact duplicates
  const bad: (string | number | null)[][] = [
    ["31/02/2025", "blue-shirt-m", 1, 799], ["yesterday", "white-shirt-l", 1, 799], ["2025-13-40", "polo-tee-m", 1, 449],
    ["", "chino-32", 1, 1099], ["n/a", "blue-jeans-34", 2, 1399], ["32/01/2025", "cotton-kurta-m", 1, 999],
    ["2025-02-30", "grey-jeans-32", 1, 1399], ["??", "track-pant-l", 1, 699], ["00-00-0000", "polo-tee-l", 1, 449],
    ["tomorrow", "blue-shirt-l", 1, 799], ["", "blue-shirt-s", 1, 799], ["15/15/2025", "formal-trouser-34", 1, 1099],
    [addDays(asOf, -3), "blue-shrit-m", 1, 799], [addDays(asOf, -9), "blue-shrit-m", 1, 799],
  ];
  const dupes: (string | number | null)[][] = [];
  for (let i = 0; i < 10; i++) dupes.push(salesRows[Math.floor(r() * salesRows.length)]);
  const all = [...salesRows];
  for (const row of [...bad, ...dupes]) all.splice(Math.floor(r() * all.length), 0, row);

  const products = toCsv(
    ["product_id", "name", "category", "unit_cost", "selling_price"],
    DEMO_SPECS.map((s) => [s.id, s.name, s.category, s.cost, s.sell]),
  );
  const inventory = toCsv(
    ["product_id", "current_stock", "reorder_level"],
    DEMO_SPECS.map((s) => [s.id, s.stock, Math.max(2, Math.round(s.base * 5))]),
  );
  const supRows: (string | number | null)[][] = [];
  for (const s of DEMO_SPECS)
    for (const [sup, price, lead, moq] of s.offers) supRows.push([sup, SUPPLIERS[sup], s.id, price, lead, moq]);
  const suppliers = toCsv(
    ["supplier_id", "supplier_name", "product_id", "price", "lead_time_days", "minimum_order_quantity"],
    supRows,
  );
  const sales = toCsv(["date", "product_id", "quantity", "price"], all);
  return {
    products, inventory, suppliers, sales,
    meta: { products: DEMO_SPECS.length, salesRows: all.length, suppliers: new Set(supRows.map((x) => x[0])).size, asOf },
  };
}
