import bcrypt from "bcrypt";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { connectDB } from "../src/config/db.js";

const password = "UMA-Demo-2026!";

const emails = [
  "demo.admin@uma.edu.pe",
  "demo.solicitante.salud@uma.edu.pe",
  "demo.director.salud@uma.edu.pe",
  "demo.vicerrector@uma.edu.pe",
  "demo.contabilidad@uma.edu.pe",
  "demo.tesoreria@uma.edu.pe",
  "demo.presupuesto@uma.edu.pe",
  "demo.gerencia@uma.edu.pe"
];

await connectDB();

try {
  console.log("");
  console.log("Resetting UMA demo credentials...");
  console.log("");

  for (const email of emails) {
    const user = await User.findOne({ email });

    if (!user) {
      console.log(`[MISSING] ${email}`);
      continue;
    }

    user.passwordHash = await bcrypt.hash(password, 12);
    user.active = true;

    await user.save();

    console.log(`[OK] ${email}`);
  }

  console.log("");
  console.log("============================================");
  console.log("DEMO PASSWORDS RESET SUCCESSFULLY");
  console.log("============================================");
  console.log("");
  console.log(`Password: ${password}`);
  console.log("");
} finally {
  await mongoose.disconnect();
}
