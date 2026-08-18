import express from 'express';
import * as sessionController from '../controllers/sessionController.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';

export const sessionRouter = express.Router();

sessionRouter.post('/', asyncHandler(sessionController.createOrReuse));
