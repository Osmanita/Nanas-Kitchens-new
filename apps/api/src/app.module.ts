import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { KitchensModule } from "./kitchens/kitchens.module";
import { InventoryModule } from "./inventory/inventory.module";
import { ChatModule } from "./chat/chat.module";

@Module({
  // No OrdersModule: ordering moved to apps/api-java and this copy was removed rather than
  // repaired. See the commit that deleted it for what it still had wrong.
  imports: [PrismaModule, AuthModule, KitchensModule, InventoryModule, ChatModule],
  controllers: [HealthController],
})
export class AppModule {}
