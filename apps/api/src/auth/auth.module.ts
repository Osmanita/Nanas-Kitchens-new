import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";

@Module({
  // 8h matches app.jwt.access-token-ttl-minutes: 480 on the Java side. Both backends sign with
  // the same JWT_SECRET, so a token minted here is accepted there and vice versa — leaving this
  // at 15m meant the two disagreed about how long the identical token stays valid.
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: "8h" } })],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
