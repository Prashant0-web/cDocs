import { Router } from "express";
import authService from "./auth.service.js";
const { signIn, signUp, verifyOTP, checkUsername } = authService;

const authRouter = Router();

authRouter.post('/sign-up', signUp)
authRouter.post('/sign-in', signIn)
authRouter.post('/verify-otp', verifyOTP)
authRouter.post('/check-username', checkUsername)
authRouter.get('/check-username', checkUsername)

export default authRouter;