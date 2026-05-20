import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';

import { Logger } from '@nestjs/common';

import { IJwtPayload } from '@common/constants';

const logger = new Logger('CheckAssetsCookieMiddleware');

export function checkAssetsCookieMiddleware(
    req: { user: IJwtPayload } & Request,
    res: Response,
    next: NextFunction,
) {
    // Static frontend files are public assets for both the subscription UI and Admin UI.
    // Admin UI is protected by its own API token; blocking assets here breaks production SPA loading.
    if (req.path.startsWith('/assets') || req.path.startsWith('/locales')) {
        return next();
    }

    const secret = process.env.INTERNAL_JWT_SECRET;

    if (!secret || !req.cookies.session) {
        return next();
    }

    try {
        const jwtPayload = jwt.verify(req.cookies.session, secret);

        req.user = jwtPayload as unknown as IJwtPayload;
    } catch (error) {
        logger.debug(error);
    }

    return next();
}
