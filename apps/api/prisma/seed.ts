/**
 * Demo seed: 1 buyer + 3 sellers with attested kitchens all around Powell, Ohio,
 * each with dishes and a published menu for today with live portions.
 *
 * Run: pnpm seed   (from apps/api)
 * Login: buyer@demo.com / demo1234
 */
// Must precede PrismaClient: this script is run directly (`pnpm seed`), not through the Nest
// bootstrap, and PrismaClient reads DATABASE_URL at construction. Only the prisma CLI loads
// .env by itself — a plain ts-node run does not.
import "../src/env";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { encryptAddress } from "@culture-eats/core";

const prisma = new PrismaClient();

// Test location: downtown Powell, Ohio (43065)
const CENTER = { lat: 40.1578, lng: -83.0752 };

// Demo food photography (Unsplash hotlinks) until seller photo upload (S3) ships.
const IMG = (id: string) => `https://images.unsplash.com/photo-${id}?w=800&q=60`;

const KITCHENS = [
  {
    seller: { email: "ayse@demo.com" },
    name: "Ayse's Anatolian Kitchen",
    cuisineTag: "turkish",
    description: "Home-style Turkish classics: manti, dolma, fresh pide.",
    address: "47 N Liberty St, Powell, OH",
    photos: [IMG("1529006557810-274b9b2fc783")],
    lat: 40.1578, lng: -83.0752, // downtown Powell
    dishes: [
      { name: "Manti (Turkish dumplings)", description: "Hand-folded beef dumplings with garlic yogurt", priceCents: 1450, dietaryTags: [], portions: 500, photo: IMG("1534422298391-e4f8c172dddb") },
      { name: "Vegetarian Dolma", description: "Grape leaves stuffed with rice, herbs, pine nuts", priceCents: 1150, dietaryTags: ["vegetarian", "vegan"], portions: 500, photo: IMG("1512621776951-a57141f2eefd") },
      { name: "Lahmacun", description: "Thin crispy flatbread with spiced minced lamb", priceCents: 950, dietaryTags: [], portions: 500, photo: IMG("1565299624946-b28f40a0ae38") },
    ],
  },
  {
    seller: { email: "fatma@demo.com" },
    name: "Fatma's Sarma House",
    cuisineTag: "turkish",
    description: "Hand-rolled sarma and stuffed vegetables, Aegean style.",
    address: "89 S Liberty St, Powell, OH",
    lat: 40.1552, lng: -83.0745, // ~0.2 mi
    dishes: [
      { name: "Yaprak Sarma", description: "Vine leaves hand-rolled with rice, currants, dill (8 pc)", priceCents: 1250, dietaryTags: ["vegetarian", "vegan"], portions: 500 },
      { name: "Lahana Sarma", description: "Cabbage rolls with spiced beef and rice, lemon broth", priceCents: 1350, dietaryTags: [], portions: 500 },
      { name: "Biber Dolma", description: "Bell peppers stuffed with herbed rice, served warm", priceCents: 1150, dietaryTags: ["vegetarian"], portions: 500 },
    ],
  },
  {
    seller: { email: "emine@demo.com" },
    name: "Emine's Manti Evi",
    cuisineTag: "turkish",
    description: "El açması manti ve ev yemekleri, Powell'ın kalbinde.",
    address: "210 W Olentangy St, Powell, OH",
    lat: 40.1620, lng: -83.0810, // ~0.5 mi
    dishes: [
      { name: "El Açması Mantı", description: "Kıymalı el mantısı, sarımsaklı yoğurt, kızgın tereyağı", priceCents: 1400, dietaryTags: [], portions: 500 },
      { name: "Kıbrıs Makarnası (Magarına Bulli)", description: "Tavuk suyunda makarna, rendelenmiş hellim", priceCents: 1100, dietaryTags: [], portions: 500 },
      { name: "Mercimek Çorbası", description: "Günlük taze mercimek çorbası, limonla", priceCents: 600, dietaryTags: ["vegetarian", "vegan"], portions: 500 },
    ],
  },
  {
    seller: { email: "havva@demo.com" },
    name: "Havva's Sarma Kosesi",
    cuisineTag: "turkish",
    description: "İncecik yaprak sarma ve dolma çeşitleri, anne usulü.",
    address: "550 Home Rd, Powell, OH",
    lat: 40.1690, lng: -83.0700, // ~1 mi
    dishes: [
      { name: "Yaprak Sarma", description: "Zeytinyağlı incecik yaprak sarma (10 adet)", priceCents: 1200, dietaryTags: ["vegetarian", "vegan"], portions: 500 },
      { name: "Etli Lahana Sarma", description: "Kıymalı lahana sarması, limonlu et suyu", priceCents: 1300, dietaryTags: [], portions: 500 },
      { name: "Kolokas Dolması", description: "Kıbrıs usulü kolokas dolması", priceCents: 1250, dietaryTags: [], portions: 500 },
    ],
  },
  {
    seller: { email: "zeynep@demo.com" },
    name: "Zeynep's Gozleme House",
    cuisineTag: "turkish",
    description: "Fresh gozleme off the sac, koftes and daily Turkish home plates.",
    address: "112 E Olentangy St, Powell, OH",
    lat: 40.1540, lng: -83.0690, // ~0.6 mi
    dishes: [
      { name: "Gozleme (spinach & feta)", description: "Hand-rolled flatbread off the griddle, 2 pieces", priceCents: 1050, dietaryTags: ["vegetarian"], portions: 500 },
      { name: "Izgara Kofte Plate", description: "Grilled beef koftes, bulgur pilaf, shepherd salad", priceCents: 1550, dietaryTags: [], portions: 500 },
      { name: "Kabak Mucveri", description: "Zucchini fritters with garlic yogurt (4 pc)", priceCents: 900, dietaryTags: ["vegetarian"], portions: 500 },
    ],
  },
  {
    seller: { email: "abeba@demo.com" },
    name: "Abeba's Injera Kitchen",
    cuisineTag: "ethiopian",
    description: "Slow-simmered wots on fresh injera, Addis home style.",
    address: "3200 Sawmill Pkwy, Powell, OH",
    lat: 40.1450, lng: -83.0850, // ~1.2 mi
    dishes: [
      { name: "Doro Wot", description: "Chicken stewed in berbere with a boiled egg, on injera", priceCents: 1600, dietaryTags: [], portions: 500 },
      { name: "Misir Wot", description: "Red lentils in spiced berbere sauce, with injera", priceCents: 1200, dietaryTags: ["vegetarian", "vegan"], portions: 500 },
      { name: "Veggie Combo", description: "Five vegetable wots arranged on fresh injera", priceCents: 1450, dietaryTags: ["vegetarian", "vegan"], portions: 500 },
    ],
  },
  {
    seller: { email: "mei@demo.com" },
    name: "Mei's Sichuan Home Cooking",
    cuisineTag: "chinese",
    description: "Bold Sichuan flavors from a family wok: mapo tofu, dan dan noodles.",
    address: "75 Village Green Dr, Powell, OH",
    photos: [IMG("1455619452474-d2be8b1e70cd")],
    lat: 40.1610, lng: -83.0650, // ~1 mi
    dishes: [
      { name: "Mapo Tofu", description: "Silky tofu in numbing-spicy chili bean sauce", priceCents: 1250, dietaryTags: ["vegetarian"], portions: 500, photo: IMG("1504674900247-0877df9cc836") },
      { name: "Dan Dan Noodles", description: "Hand-pulled noodles, sesame-chili sauce, minced pork", priceCents: 1350, dietaryTags: [], portions: 500, photo: IMG("1476224203421-9ac39bcb3327") },
      { name: "Cucumber Salad", description: "Smashed cucumber, garlic, black vinegar", priceCents: 650, dietaryTags: ["vegan", "gluten-free"], portions: 500, photo: IMG("1546069901-ba9599a7e63c") },
    ],
  },
  {
    seller: { email: "rosa@demo.com" },
    name: "Rosa's Cocina Oaxaquena",
    cuisineTag: "mexican",
    description: "Oaxacan mole, handmade tortillas, tamales like abuela made.",
    address: "980 Seldom Seen Rd, Powell, OH",
    photos: [IMG("1599974579688-8dbdd335c77f")],
    lat: 40.1500, lng: -83.0600, // ~1.5 mi
    dishes: [
      { name: "Mole Negro con Pollo", description: "Chicken in 28-ingredient black mole, rice, tortillas", priceCents: 1650, dietaryTags: [], portions: 500, photo: IMG("1565299585323-38d6b0865b47") },
      { name: "Tamales de Rajas", description: "Poblano & cheese tamales in banana leaf (2 pc)", priceCents: 1050, dietaryTags: ["vegetarian"], portions: 500, photo: IMG("1551504734-5ee1c4a1479b") },
      { name: "Tlayuda", description: "Crispy tortilla, beans, quesillo, avocado", priceCents: 1250, dietaryTags: ["vegetarian"], portions: 500, photo: IMG("1555939594-58d7cb561ad1") },
    ],
  },
];

/** Dev photo + kcal metadata by dish-name keyword (mirrors /public/dishes assets). */
/** Used only when a dish neither matches dishMeta() nor carries its own photo. */
const DEFAULT_DISH_PHOTO = "/dishes/gozleme.jpg";

/** photo is null when no curated local image fits the dish — the caller falls back. */
function dishMeta(name: string): { photo: string | null; calories: number } {
  const n = name.toLowerCase();
  if (n.includes("mant")) return { photo: "/dishes/manti.jpg", calories: 560 };
  if (n.includes("yaprak sarma")) return { photo: "/dishes/sarma.jpg", calories: 320 };
  if (n.includes("lahana sarma")) return { photo: "/dishes/sarma.jpg", calories: 430 };
  if (n.includes("dolma")) return { photo: "/dishes/dolma.jpg", calories: 350 };
  if (n.includes("gozleme")) return { photo: "/dishes/gozleme.jpg", calories: 480 };
  if (n.includes("mercimek")) return { photo: "/dishes/lentil.jpg", calories: 240 };
  if (n.includes("makarna")) return { photo: "/dishes/manti.jpg", calories: 520 };
  if (n.includes("wot") || n.includes("veggie combo")) return { photo: "/dishes/injera.jpg", calories: 500 };
  if (n.includes("mapo") || n.includes("dan dan")) return { photo: "/dishes/mapo.jpg", calories: 450 };
  if (n.includes("cucumber")) return { photo: "/dishes/mapo.jpg", calories: 120 };
  if (n.includes("mole") || n.includes("tamales") || n.includes("tlayuda")) return { photo: "/dishes/mole.jpg", calories: 550 };
  return { photo: null, calories: 420 };
}

async function main() {
  const passwordHash = await argon2.hash("demo1234");

  // Buyer + platform-invited roles (Story 7.2: inspectors/admins have no open signup)
  for (const u of [
    { email: "buyer@demo.com", role: "buyer" },
    { email: "inspector@demo.com", role: "inspector" },
    { email: "admin@demo.com", role: "admin" },
  ] as const) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, passwordHash, role: u.role },
    });
    console.log(`${u.email} / demo1234`);
  }

  const today = new Date(new Date().toISOString().slice(0, 10)); // midnight UTC today

  for (const k of KITCHENS) {
    const seller = await prisma.user.upsert({
      where: { email: k.seller.email },
      update: {},
      create: { email: k.seller.email, passwordHash, role: "seller" },
    });

    let kitchen = await prisma.kitchen.findUnique({ where: { sellerId: seller.id } });
    if (!kitchen) {
      kitchen = await prisma.kitchen.create({
        data: {
          sellerId: seller.id,
          name: k.name,
          cuisineTag: k.cuisineTag,
          description: k.description,
          addressEncrypted: encryptAddress(k.address),
          photos: k.photos,
          complianceAttestedAt: new Date(), // attested so it appears in search
        },
      });
    } else {
      // Keep the source-of-truth fields in sync on re-seed (e.g. relocating the whole demo
      // marketplace) rather than only ever setting them once at first creation.
      await prisma.kitchen.update({
        where: { id: kitchen.id },
        data: { addressEncrypted: encryptAddress(k.address), description: k.description },
      });
    }
    await prisma.$executeRaw`
      UPDATE "Kitchen" SET geo = ST_SetSRID(ST_MakePoint(${k.lng}, ${k.lat}), 4326)::geography
      WHERE id = ${kitchen.id}`;

    // Published menu for today (idempotent via @@unique([kitchenId, date]))
    const existing = await prisma.menuDay.findUnique({
      where: { kitchenId_date: { kitchenId: kitchen.id, date: today } },
    });
    if (!existing) {
      const menuDay = await prisma.menuDay.create({
        data: {
          kitchenId: kitchen.id,
          date: today,
          status: "published",
          readyWindows: [{ start: "17:00", end: "20:00", slotMinutes: 30 }],
        },
      });
      for (const d of k.dishes) {
        const meta = dishMeta(d.name);
        const fields = {
          description: d.description,
          // Curated local file first, then the dish's own photo, then the generic fallback.
          // This used to be two "photo" keys in one object literal — the second silently won,
          // so every per-dish photo above was dead code and any dish dishMeta() did not match
          // (Lahmacun, Izgara Kofte) was served someone else's picture.
          // "photo" in d: only some dish literals carry one, so the union type has no such
          // property in common. (The old `photo: d.photo` line was a type error too — nothing
          // was type-checking this file. See tsconfig.seed.json.)
          photo: meta.photo ?? ("photo" in d ? d.photo : undefined) ?? DEFAULT_DISH_PHOTO,
          priceCents: d.priceCents,
          dietaryTags: d.dietaryTags,
          calories: meta.calories,
        };
        // The Dish catalogue belongs to the kitchen, not to the day. Creating it unconditionally
        // meant every new UTC day (when the MenuDay guard above lets us in) duplicated all of a
        // kitchen's dishes; after a week the seller's dish list was seven times too long.
        // orderBy so repeat runs keep updating the SAME row. Databases seeded before this fix
        // still hold one duplicate per dish per extra UTC day the old code ran; those are stale
        // rows that nothing new points at, and a fresh `pnpm seed` on an empty database is the
        // clean way out of them.
        const existingDish = await prisma.dish.findFirst({
          where: { kitchenId: kitchen.id, name: d.name },
          orderBy: { id: "asc" },
        });
        const dish = existingDish
          ? await prisma.dish.update({ where: { id: existingDish.id }, data: fields })
          : await prisma.dish.create({ data: { kitchenId: kitchen.id, name: d.name, ...fields } });
        await prisma.menuItem.create({
          data: { menuDayId: menuDay.id, dishId: dish.id, portionsTotal: d.portions, portionsRemaining: d.portions },
        });
      }
    }
    console.log(`${k.name} — ${k.dishes.length} dishes, menu published for today`);
  }

  console.log(`\nSearch from lat=${CENTER.lat} lng=${CENTER.lng} (Powell, OH)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
