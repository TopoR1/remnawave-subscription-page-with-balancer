export const ru = {
    admin: {
        title: 'Remnawave Balancer by TopoR',
        subtitle: 'Панель состояния и управления балансировщиком',
        refresh: 'Обновить',
        logout: 'Выйти',
        tokenTitle: 'Токен администратора',
        tokenLabel: 'Токен',
        tokenPlaceholder: 'Вставьте TOPOR_BALANCER_ADMIN_TOKEN',
        signIn: 'Войти',
        advancedSettings: 'Расширенные настройки',
        nodes: 'Ноды',
        assignments: 'Назначения',
        requests: 'Запросы',
        addNode: 'Добавить ноду',
        search: 'Поиск',
        status: 'Статус',
        planCode: 'Код тарифа',
        publicHost: 'Публичный хост',
        retryConfig: 'Повторить',
        configLoadError: 'Не удалось загрузить конфигурацию панели',
    },
    balancingHelp: {
        stickyAssignment:
            'Sticky Assignment закрепляет пользователя за выбранной нодой. Рекомендуется включать в database mode, чтобы подписка не прыгала между серверами.',
        weightedBalancing:
            'Weighted Balancing распределяет новых пользователей с учетом веса ноды. Обычное значение 1, более мощным нодам можно дать 2 или выше.',
        healthChecks:
            'Health Checks помогают исключать dead/disabled/draining ноды из новых назначений. Для production держите статусы актуальными.',
        failover:
            'Failover переводит пользователей с disabled или dead нод на активные цели той же группы. Перед отключением ноды используйте draining.',
        nodeWeight:
            'Node Weight влияет на долю новых назначений. Рекомендуем 1 для равных серверов, больше 1 для более мощных.',
        maxUsers:
            'Max Users ограничивает количество закрепленных пользователей на ноде. Задавайте с запасом по реальной емкости сервера.',
        publicHostCode:
            'publicHostCode объединяет технические хосты в публичную группу, которую видит подписка.',
        technicalHostName:
            'technicalHostName должен совпадать с реальным хостом в исходной подписке Remnawave.',
    },
} as const
