/**
 * Demo seed: 1 buyer + 3 sellers with attested kitchens near downtown SF,
 * each with dishes and a published menu for today with live portions.
 *
 * Run: pnpm seed   (from apps/api)
 * Login: buyer@demo.com / demo1234
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { encryptAddress } from "@culture-eats/core";

const prisma = new PrismaClient();

// Test location: Union Square, San Francisco
const CENTER = { lat: 37.788, lng: -122.4075 };

// Demo food photography (Unsplash hotlinks) until seller photo upload (S3) ships.
const IMG = (id: string) => `https://images.unsplash.com/photo-${id}?w=800&q=60`;

const KITCHENS = [
  {
    seller: { email: "ayse@demo.com" },
    name: "Ayse's Anatolian Kitchen",
    cuisineTag: "turkish",
    description: "Home-style Turkish classics: manti, dolma, fresh pide.",
    address: "350 Post St, San Francisco, CA",
    photos: [IMG("1529006557810-274b9b2fc783")],
    lat: 37.7885, lng: -122.4078, // ~0.1 mi
    dishes: [
      { name: "Manti (Turkish dumplings)", description: "Hand-folded beef dumplings with garlic yogurt", priceCents: 1450, dietaryTags: [], portions: 8, photo: IMG("1534422298391-e4f8c172dddb") },
      { name: "Vegetarian Dolma", description: "Grape leaves stuffed with rice, herbs, pine nuts", priceCents: 1150, dietaryTags: ["vegetarian", "vegan"], portions: 12, photo: IMG("1512621776951-a57141f2eefd") },
      { name: "Lahmacun", description: "Thin crispy flatbread with spiced minced lamb", priceCents: 950, dietaryTags: [], portions: 10, photo: IMG("1565299624946-b28f40a0ae38") },
    ],
  },
  {
    seller: { email: "fatma@demo.com" },
    name: "Fatma's Sarma House",
    cuisineTag: "turkish",
    description: "Hand-rolled sarma and stuffed vegetables, Aegean style.",
    address: "450 Sutter St, San Francisco, CA",
    lat: 37.7893, lng: -122.4071, // ~0.1 mi
    dishes: [
      { name: "Yaprak Sarma", description: "Vine leaves hand-rolled with rice, currants, dill (8 pc)", priceCents: 1250, dietaryTags: ["vegetarian", "vegan"], portions: 14 },
      { name: "Lahana Sarma", description: "Cabbage rolls with spiced beef and rice, lemon broth", priceCents: 1350, dietaryTags: [], portions: 10 },
      { name: "Biber Dolma", description: "Bell peppers stuffed with herbed rice, served warm", priceCents: 1150, dietaryTags: ["vegetarian"], portions: 8 },
    ],
  },
  // Cyprus cluster (Lefkoşa) — so "yakınımda" works for testers located there too.
  {
    seller: { email: "emine@demo.com" },
    name: "Emine's Manti Evi",
    cuisineTag: "turkish",
    description: "El açması mantı ve ev yemekleri, Lefkoşa'nın kalbinde.",
    address: "Girne Caddesi 42, Lefkoşa",
    lat: 35.1856, lng: 33.3823,
    dishes: [
      { name: "El Açması Mantı", description: "Kıymalı el mantısı, sarımsaklı yoğurt, kızgın tereyağı", priceCents: 1400, dietaryTags: [], portions: 12 },
      { name: "Kıbrıs Makarnası (Magarına Bulli)", description: "Tavuk suyunda makarna, rendelenmiş hellim", priceCents: 1100, dietaryTags: [], portions: 10 },
      { name: "Mercimek Çorbası", description: "Günlük taze mercimek çorbası, limonla", priceCents: 600, dietaryTags: ["vegetarian", "vegan"], portions: 15 },
    ],
  },
  {
    seller: { email: "havva@demo.com" },
    name: "Havva's Sarma Kosesi",
    cuisineTag: "turkish",
    description: "İncecik yaprak sarma ve dolma çeşitleri, anne usulü.",
    address: "Dereboyu Caddesi 15, Lefkoşa",
    lat: 35.1932, lng: 33.3711, // ~0.7 mi
    dishes: [
      { name: "Yaprak Sarma", description: "Zeytinyağlı incecik yaprak sarma (10 adet)", priceCents: 1200, dietaryTags: ["vegetarian", "vegan"], portions: 14 },
      { name: "Etli Lahana Sarma", description: "Kıymalı lahana sarması, limonlu et suyu", priceCents: 1300, dietaryTags: [], portions: 10 },
      { name: "Kolokas Dolması", description: "Kıbrıs usulü kolokas dolması", priceCents: 1250, dietaryTags: [], portions: 8 },
    ],
  },
  // Columbus, Ohio cluster — for remote testers in the US Midwest.
  {
    seller: { email: "zeynep@demo.com" },
    name: "Zeynep's Gozleme House",
    cuisineTag: "turkish",
    description: "Fresh gozleme off the sac, koftes and daily Turkish home plates.",
    address: "1120 N High St, Columbus, OH",
    lat: 39.9852, lng: -83.0007, // Short North
    dishes: [
      { name: "Gozleme (spinach & feta)", description: "Hand-rolled flatbread off the griddle, 2 pieces", priceCents: 1050, dietaryTags: ["vegetarian"], portions: 12 },
      { name: "Izgara Kofte Plate", description: "Grilled beef koftes, bulgur pilaf, shepherd salad", priceCents: 1550, dietaryTags: [], portions: 10 },
      { name: "Kabak Mucveri", description: "Zucchini fritters with garlic yogurt (4 pc)", priceCents: 900, dietaryTags: ["vegetarian"], portions: 8 },
    ],
  },
  {
    seller: { email: "abeba@demo.com" },
    name: "Abeba's Injera Kitchen",
    cuisineTag: "ethiopian",
    description: "Slow-simmered wots on fresh injera, Addis home style.",
    address: "3411 Cleveland Ave, Columbus, OH",
    lat: 40.0392, lng: -82.9701, // ~4.5 mi from Short North
    dishes: [
      { name: "Doro Wot", description: "Chicken stewed in berbere with a boiled egg, on injera", priceCents: 1600, dietaryTags: [], portions: 9 },
      { name: "Misir Wot", description: "Red lentils in spiced berbere sauce, with injera", priceCents: 1200, dietaryTags: ["vegetarian", "vegan"], portions: 14 },
      { name: "Veggie Combo", description: "Five vegetable wots arranged on fresh injera", priceCents: 1450, dietaryTags: ["vegetarian", "vegan"], portions: 10 },
    ],
  },
  {
    seller: { email: "mei@demo.com" },
    name: "Mei's Sichuan Home Cooking",
    cuisineTag: "chinese",
    description: "Bold Sichuan flavors from a family wok: mapo tofu, dan dan noodles.",
    address: "728 Pacific Ave, San Francisco, CA",
    photos: [IMG("1455619452474-d2be8b1e70cd")],
    lat: 37.7967, lng: -122.4097, // ~0.6 mi
    dishes: [
      { name: "Mapo Tofu", description: "Silky tofu in numbing-spicy chili bean sauce", priceCents: 1250, dietaryTags: ["vegetarian"], portions: 10, photo: IMG("1504674900247-0877df9cc836") },
      { name: "Dan Dan Noodles", description: "Hand-pulled noodles, sesame-chili sauce, minced pork", priceCents: 1350, dietaryTags: [], portions: 8, photo: IMG("1476224203421-9ac39bcb3327") },
      { name: "Cucumber Salad", description: "Smashed cucumber, garlic, black vinegar", priceCents: 650, dietaryTags: ["vegan", "gluten-free"], portions: 15, photo: IMG("1546069901-ba9599a7e63c") },
    ],
  },
  {
    seller: { email: "rosa@demo.com" },
    name: "Rosa's Cocina Oaxaquena",
    cuisineTag: "mexican",
    description: "Oaxacan mole, handmade tortillas, tamales like abuela made.",
    address: "2889 Mission St, San Francisco, CA",
    photos: [IMG("1599974579688-8dbdd335c77f")],
    lat: 37.7517, lng: -122.4183, // ~2.6 mi
    dishes: [
      { name: "Mole Negro con Pollo", description: "Chicken in 28-ingredient black mole, rice, tortillas", priceCents: 1650, dietaryTags: [], portions: 6, photo: IMG("1565299585323-38d6b0865b47") },
      { name: "Tamales de Rajas", description: "Poblano & cheese tamales in banana leaf (2 pc)", priceCents: 1050, dietaryTags: ["vegetarian"], portions: 12, photo: IMG("1551504734-5ee1c4a1479b") },
      { name: "Tlayuda", description: "Crispy tortilla, beans, quesillo, avocado", priceCents: 1250, dietaryTags: ["vegetarian"], portions: 9, photo: IMG("1555939594-58d7cb561ad1") },
    ],
  },
];

/** Dev photo + kcal metadata by dish-name keyword (mirrors /public/dishes assets). */
function dishMeta(name: string): { photo: string; calories: number } {
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
  return { photo: "/dishes/gozleme.jpg", calories: 420 };
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
      await prisma.$executeRaw`
        UPDATE "Kitchen" SET geo = ST_SetSRID(ST_MakePoint(${k.lng}, ${k.lat}), 4326)::geography
        WHERE id = ${kitchen.id}`;
    }

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
        const dish = await prisma.dish.create({
          data: {
            kitchenId: kitchen.id,
            name: d.name,
            description: d.description,
            photo: meta.photo || d.photo,
            priceCents: d.priceCents,
            dietaryTags: d.dietaryTags,
            calories: meta.calories,
          },
        });
        await prisma.menuItem.create({
          data: { menuDayId: menuDay.id, dishId: dish.id, portionsTotal: d.portions, portionsRemaining: d.portions },
        });
      }
    }
    console.log(`${k.name} — ${k.dishes.length} dishes, menu published for today`);
  }

  console.log(`\nSearch from lat=${CENTER.lat} lng=${CENTER.lng} (Union Square, SF)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
