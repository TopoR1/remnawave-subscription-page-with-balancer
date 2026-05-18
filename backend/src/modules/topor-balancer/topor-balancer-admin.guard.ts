import {
    CanActivate,
    ExecutionContext,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';

import { ToporBalancerService } from './topor-balancer.service';

@Injectable()
export class ToporBalancerAdminGuard implements CanActivate {
    constructor(private readonly toporBalancerService: ToporBalancerService) {}

    public canActivate(context: ExecutionContext): boolean {
        const adminToken = this.toporBalancerService.getAdminToken();

        if (!adminToken) {
            throw new NotFoundException();
        }

        const request = context.switchToHttp().getRequest<{
            headers: Record<string, string | string[] | undefined>;
        }>();
        const authorizationHeader = request.headers.authorization;
        const authorization = Array.isArray(authorizationHeader)
            ? authorizationHeader[0]
            : authorizationHeader;

        if (authorization !== `Bearer ${adminToken}`) {
            throw new UnauthorizedException();
        }

        return true;
    }
}
