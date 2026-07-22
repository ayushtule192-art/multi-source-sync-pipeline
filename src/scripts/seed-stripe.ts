/**
 * Stripe Seed Script
 * Creates dummy test payments directly via the Stripe API
 * Run with: npx ts-node src/scripts/seed-stripe.ts
 */
import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-06-24.dahlia" as any });

const TEST_PAYMENTS = [
  { amount: 4999, description: "Pro Plan Subscription", token: "tok_visa" },
  { amount: 1999, description: "Basic Plan Subscription", token: "tok_visa" },
  { amount: 9999, description: "Enterprise License", token: "tok_visa" },
  { amount: 2500, description: "Add-on Feature Pack", token: "tok_visa" },
  { amount: 1500, description: "Monthly Support", token: "tok_chargeDeclined" }, // This will FAIL - tests our metrics exclusion
];

async function seedStripe() {
  console.log("🌱 Seeding Stripe with test payments...\n");

  for (const payment of TEST_PAYMENTS) {
    try {
      // Create a payment method from a test token
      const paymentMethod = await stripe.paymentMethods.create({
        type: "card",
        card: { token: payment.token === "tok_chargeDeclined" ? "tok_chargeDeclined" : "tok_visa" },
      });

      // Create a payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: payment.amount,
        currency: "usd",
        payment_method: paymentMethod.id,
        confirm: true,
        description: payment.description,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      });

      console.log(`  ✓ ${payment.description}: $${payment.amount / 100} — status: ${paymentIntent.status}`);
    } catch (err: any) {
      // Expected for declined cards — this is intentional to test our metrics
      console.log(`  ⚠ ${payment.description}: $${payment.amount / 100} — FAILED (${err.raw?.message || err.message})`);
    }
  }

  console.log("\n✅ Done! Now run: curl -X POST http://localhost:3000/sync/trigger");
  console.log("   Then check:    curl http://localhost:3000/transactions");
  process.exit(0);
}

seedStripe().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
