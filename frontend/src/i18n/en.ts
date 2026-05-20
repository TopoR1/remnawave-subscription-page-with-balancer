export const en = {
    admin: {
        title: 'Remnawave Balancer by TopoR',
        subtitle: 'Balancer status and control panel',
        refresh: 'Refresh',
        logout: 'Logout',
        tokenTitle: 'Admin token',
        tokenLabel: 'Token',
        tokenPlaceholder: 'Paste TOPOR_BALANCER_ADMIN_TOKEN',
        signIn: 'Sign in',
        advancedSettings: 'Advanced settings',
        nodes: 'Nodes',
        assignments: 'Assignments',
        requests: 'Requests',
        addNode: 'Add node',
        search: 'Search',
        status: 'Status',
        planCode: 'Plan code',
        publicHost: 'Public host',
        retryConfig: 'Retry',
        configLoadError: 'Unable to load panel configuration',
    },
    balancingHelp: {
        stickyAssignment:
            'Sticky Assignment keeps a user on the selected node. Recommended in database mode to avoid subscription jumps between servers.',
        weightedBalancing:
            'Weighted Balancing distributes new users according to node weight. Use 1 for normal nodes and higher values for stronger nodes.',
        healthChecks:
            'Health Checks keep dead, disabled, and draining nodes out of new assignments. Keep statuses current in production.',
        failover:
            'Failover moves users from disabled or dead nodes to active targets in the same group. Use draining before disabling a node.',
        nodeWeight:
            'Node Weight controls the share of new assignments. Use 1 for equal servers, higher values for stronger ones.',
        maxUsers:
            'Max Users caps assigned users on a node. Set it with headroom based on real server capacity.',
        publicHostCode:
            'publicHostCode groups technical hosts into the public host group shown in subscriptions.',
        technicalHostName:
            'technicalHostName must match the real host in the original Remnawave subscription.',
    },
} as const
