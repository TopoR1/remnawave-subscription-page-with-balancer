import { Request, Response } from 'express';
import path from 'node:path';

import { Get, Controller, Res, Req, Param, Logger, UseGuards } from '@nestjs/common';

import {
    REQUEST_TEMPLATE_TYPE_VALUES,
    TRequestTemplateTypeKeys,
} from '@remnawave/backend-contract';
import { APP_CONFIG_ROUTE_WO_LEADING_PATH } from '@remnawave/subscription-page-types';

import { GetJWTPayload } from '@common/decorators/get-jwt-payload';
import { ClientIp } from '@common/decorators/get-ip';
import { IJwtPayload } from '@common/constants';
import { isDevelopment } from '@common/utils/startup-app';

import { RuntimeConfigService } from './runtime-config.service';
import { RootService } from './root.service';
import { ToporBalancerAdminGuard } from '@modules/topor-balancer';

@Controller()
export class RootController {
    private readonly logger = new Logger(RootController.name);
    private readonly assetsPath = isDevelopment()
        ? path.join(__dirname, '..', '..', 'dev_frontend')
        : '/opt/app/frontend';

    constructor(
        private readonly rootService: RootService,
        private readonly runtimeConfigService: RuntimeConfigService,
    ) {}

    @Get(APP_CONFIG_ROUTE_WO_LEADING_PATH)
    async getSubscriptionPageConfig(
        @GetJWTPayload() user: IJwtPayload | undefined,
        @Req() request: Request,
        @Res() response: Response,
    ) {
        const config = this.runtimeConfigService.getRuntimeConfig(user, request);
        const serializedConfig = this.runtimeConfigService.serializeRuntimeConfig(config);

        response.type('application/json').status(200).send(serializedConfig);
    }

    @Get('admin/topor-balancer')
    async getToporBalancerAdminPage(@Res() response: Response) {
        return response.render('index', {
            metaTitle: 'Remnawave Balancer by TopoR',
            metaDescription: 'TopoR Balancer admin panel',
            panelData: '',
        });
    }

    @Get('admin/topor-balancer/*path')
    async getToporBalancerAdminSpaFallback(@Res() response: Response) {
        return this.getToporBalancerAdminPage(response);
    }

    @Get(['favicon.svg', 'favicon-32x32.png', 'favicon-16x16.png'])
    async getRootFavicons(@Req() request: Request, @Res() response: Response) {
        return response.sendFile(
            path.join(this.assetsPath, 'assets', request.path.slice(1)),
            (error) => {
                if (error && !response.headersSent) {
                    response.sendStatus(404);
                }
            },
        );
    }

    @Get(['assets', 'assets/*path', 'locales', 'locales/*path'])
    async getMissingStaticAsset(@Res() response: Response) {
        return response.sendStatus(404);
    }

    @Get([':shortUuid', ':shortUuid/:clientType'])
    async root(
        @ClientIp() clientIp: string,
        @Req() request: Request,
        @Res() response: Response,
        @Param('shortUuid') shortUuid: string,
        @Param('clientType') clientType: string,
    ) {
        if (request.path.startsWith('/assets') || request.path.startsWith('/locales')) {
            response.socket?.destroy();
            return;
        }

        if (clientType === undefined) {
            return await this.rootService.serveSubscriptionPage(
                clientIp,
                request,
                response,
                shortUuid,
            );
        }

        if (!REQUEST_TEMPLATE_TYPE_VALUES.includes(clientType as TRequestTemplateTypeKeys)) {
            this.logger.error(`Invalid client type: ${clientType}`);

            response.socket?.destroy();
            return;
        } else {
            return await this.rootService.serveSubscriptionPage(
                clientIp,
                request,
                response,
                shortUuid,
                clientType as TRequestTemplateTypeKeys,
            );
        }
    }
}

@UseGuards(ToporBalancerAdminGuard)
@Controller('api/topor-balancer')
export class RuntimeConfigHealthController {
    constructor(private readonly runtimeConfigService: RuntimeConfigService) {}

    @Get('runtime-config-health')
    public health() {
        return this.runtimeConfigService.getHealth();
    }
}
