import {
    Alert,
    Badge,
    Button,
    Card,
    Container,
    Group,
    Modal,
    NumberInput,
    PasswordInput,
    ScrollArea,
    Select,
    SimpleGrid,
    Stack,
    Switch,
    Table,
    Tabs,
    Text,
    TextInput,
    Tooltip,
    Title
} from '@mantine/core'
import {
    IconAlertTriangle,
    IconDatabase,
    IconEdit,
    IconInfoCircle,
    IconLogout,
    IconPlus,
    IconRefresh,
    IconShieldLock,
    IconSwitchHorizontal,
    IconTrash
} from '@tabler/icons-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { notifications } from '@mantine/notifications'

import { Page } from '@shared/ui'
import { defaultLocale, i18n } from '../../../i18n'

import classes from './topor-balancer-admin.module.css'

const ADMIN_TOKEN_STORAGE_KEY = 'toporBalancerAdminToken'
const ADMIN_HEALTH_URL = '/api/topor-balancer/health'
const ADMIN_NODES_URL = '/api/topor-balancer/nodes'
const ADMIN_ASSIGNMENTS_URL = '/api/topor-balancer/assignments'
const ADMIN_REASSIGN_URL = '/api/topor-balancer/reassign'
const ADMIN_REQUESTS_URL = '/api/topor-balancer/requests'
const MAX_ASSIGNMENTS_DISPLAY = 500
const MAX_REQUESTS_DISPLAY = 500

const NODE_STATUSES = ['active', 'draining', 'disabled', 'dead'] as const
const t = i18n[defaultLocale]

type ToporBalancerNodeStatus = (typeof NODE_STATUSES)[number]

interface ToporBalancerHealth {
    assignmentCount: number
    assignmentMode: string
    configLoaded: boolean
    databaseConnected: boolean
    enabled: boolean
    lastError?: string
    nodeCount: number
    requestCount?: number
}

interface ToporBalancerNode {
    assignedUsers: number
    id: string
    locationCode?: string
    maxUsers: number
    planCode: string
    publicHostCode: string
    publicName: string
    status: ToporBalancerNodeStatus
    technicalHostName: string
    updatedAt?: string
    weight: number
}

interface ToporBalancerAssignment {
    createdAt?: string
    id: string
    nodeId: string
    planCode: string
    publicHostCode: string
    shortUuid: string
    technicalHostName?: string
    updatedAt?: string
}

interface ToporBalancerRequest {
    createdAt?: string
    errorMessage?: string
    id: string
    inputLinksCount?: number
    outputLinksCount?: number
    responseFormat?: string
    shortUuid: string
    status?: string
    userAgent?: string
}

interface NodeEditForm {
    locationCode: string
    maxUsers: number
    planCode: string
    publicHostCode: string
    publicName: string
    status: ToporBalancerNodeStatus
    technicalHostName: string
    weight: number
}

type AdminErrorType = 'disabled' | 'invalid-token' | 'unknown' | null

function getResponseStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined
    }

    const maybeError = error as {
        response?: {
            status?: number
        }
        status?: number
    }

    return maybeError.status ?? maybeError.response?.status
}

function isToporBalancerHealth(value: unknown): value is ToporBalancerHealth {
    if (typeof value !== 'object' || value === null) {
        return false
    }

    const maybeHealth = value as Partial<ToporBalancerHealth>

    return (
        typeof maybeHealth.assignmentCount === 'number' &&
        typeof maybeHealth.assignmentMode === 'string' &&
        typeof maybeHealth.configLoaded === 'boolean' &&
        typeof maybeHealth.databaseConnected === 'boolean' &&
        typeof maybeHealth.enabled === 'boolean' &&
        typeof maybeHealth.nodeCount === 'number'
    )
}

function isToporBalancerNode(value: unknown): value is ToporBalancerNode {
    if (typeof value !== 'object' || value === null) {
        return false
    }

    const maybeNode = value as Partial<ToporBalancerNode>

    return (
        typeof maybeNode.assignedUsers === 'number' &&
        typeof maybeNode.id === 'string' &&
        typeof maybeNode.maxUsers === 'number' &&
        typeof maybeNode.planCode === 'string' &&
        typeof maybeNode.publicHostCode === 'string' &&
        typeof maybeNode.publicName === 'string' &&
        typeof maybeNode.technicalHostName === 'string' &&
        typeof maybeNode.weight === 'number' &&
        NODE_STATUSES.includes(maybeNode.status as ToporBalancerNodeStatus)
    )
}

function isToporBalancerNodes(value: unknown): value is ToporBalancerNode[] {
    return Array.isArray(value) && value.every(isToporBalancerNode)
}

function isToporBalancerAssignment(value: unknown): value is ToporBalancerAssignment {
    if (typeof value !== 'object' || value === null) {
        return false
    }

    const maybeAssignment = value as Partial<ToporBalancerAssignment>

    return (
        typeof maybeAssignment.id === 'string' &&
        typeof maybeAssignment.nodeId === 'string' &&
        typeof maybeAssignment.planCode === 'string' &&
        typeof maybeAssignment.publicHostCode === 'string' &&
        typeof maybeAssignment.shortUuid === 'string'
    )
}

function isToporBalancerAssignments(value: unknown): value is ToporBalancerAssignment[] {
    return Array.isArray(value) && value.every(isToporBalancerAssignment)
}

function isToporBalancerRequest(value: unknown): value is ToporBalancerRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }

    const maybeRequest = value as Partial<ToporBalancerRequest>

    return typeof maybeRequest.id === 'string' && typeof maybeRequest.shortUuid === 'string'
}

function isToporBalancerRequests(value: unknown): value is ToporBalancerRequest[] {
    return Array.isArray(value) && value.every(isToporBalancerRequest)
}

function getStatusColor(status: ToporBalancerNodeStatus) {
    const statusColors: Record<ToporBalancerNodeStatus, string> = {
        active: 'green',
        dead: 'red',
        disabled: 'gray',
        draining: 'yellow'
    }

    return statusColors[status]
}

function getLoadPercent(node: ToporBalancerNode) {
    return Math.round((node.assignedUsers / node.maxUsers) * 100)
}

function formatDate(value?: string) {
    if (!value) {
        return '-'
    }

    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
        return value
    }

    return date.toLocaleString()
}

function selectOptions(values: string[]) {
    return [...new Set(values)]
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({
            label: value,
            value
        }))
}

function Help({ label }: { label: string }) {
    return (
        <Tooltip label={label} maw={360} multiline withArrow>
            <IconInfoCircle size={16} />
        </Tooltip>
    )
}

function redactSensitiveText(value?: string) {
    if (!value) {
        return '-'
    }

    return value
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
        .replace(/(token|key|secret|password)=([^&\s]+)/gi, '$1=[redacted]')
        .replace(/vless:\/\/[^\s]+/gi, '[subscription-link-redacted]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip-redacted]')
        .replace(/\b(?:[a-f0-9]{1,4}:){2,}[a-f0-9]{1,4}\b/gi, '[ip-redacted]')
}

export function ToporBalancerAdminPage() {
    const [tokenInput, setTokenInput] = useState('')
    const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY))
    const [health, setHealth] = useState<null | ToporBalancerHealth>(null)
    const [nodes, setNodes] = useState<ToporBalancerNode[]>([])
    const [assignments, setAssignments] = useState<ToporBalancerAssignment[]>([])
    const [requests, setRequests] = useState<ToporBalancerRequest[]>([])
    const [errorType, setErrorType] = useState<AdminErrorType>(null)
    const [errorMessage, setErrorMessage] = useState('')
    const [requestsErrorMessage, setRequestsErrorMessage] = useState('')
    const [isHealthLoading, setIsHealthLoading] = useState(false)
    const [isNodesLoading, setIsNodesLoading] = useState(false)
    const [isAssignmentsLoading, setIsAssignmentsLoading] = useState(false)
    const [isRequestsLoading, setIsRequestsLoading] = useState(false)
    const [isNodeActionLoading, setIsNodeActionLoading] = useState(false)
    const [isAssignmentActionLoading, setIsAssignmentActionLoading] = useState(false)
    const [searchValue, setSearchValue] = useState('')
    const [statusFilter, setStatusFilter] = useState<null | string>(null)
    const [planCodeFilter, setPlanCodeFilter] = useState<null | string>(null)
    const [publicHostCodeFilter, setPublicHostCodeFilter] = useState<null | string>(null)
    const [assignmentShortUuidFilter, setAssignmentShortUuidFilter] = useState('')
    const [assignmentPublicHostCodeFilter, setAssignmentPublicHostCodeFilter] = useState<null | string>(null)
    const [assignmentPlanCodeFilter, setAssignmentPlanCodeFilter] = useState<null | string>(null)
    const [assignmentNodeFilter, setAssignmentNodeFilter] = useState('')
    const [requestShortUuidFilter, setRequestShortUuidFilter] = useState('')
    const [requestResponseFormatFilter, setRequestResponseFormatFilter] = useState<null | string>(null)
    const [requestStatusFilter, setRequestStatusFilter] = useState<null | string>(null)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [isCreateNodeModalOpen, setIsCreateNodeModalOpen] = useState(false)
    const [editingNode, setEditingNode] = useState<null | ToporBalancerNode>(null)
    const [pendingDisableNode, setPendingDisableNode] = useState<null | ToporBalancerNode>(null)
    const [pendingDeleteNode, setPendingDeleteNode] = useState<null | ToporBalancerNode>(null)
    const [pendingReassignAssignment, setPendingReassignAssignment] =
        useState<null | ToporBalancerAssignment>(null)
    const [targetTechnicalHostName, setTargetTechnicalHostName] = useState<null | string>(null)
    const [editForm, setEditForm] = useState<NodeEditForm>({
        locationCode: '',
        maxUsers: 1,
        planCode: 'standard',
        publicHostCode: '',
        publicName: '',
        status: 'active',
        technicalHostName: '',
        weight: 1
    })

    const isLoggedIn = Boolean(adminToken)
    const isLoading =
        isHealthLoading ||
        isNodesLoading ||
        isAssignmentsLoading ||
        isRequestsLoading ||
        isNodeActionLoading ||
        isAssignmentActionLoading

    const handleAuthFailure = useCallback((message = 'Неверный токен администратора') => {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
        setAdminToken(null)
        setHealth(null)
        setNodes([])
        setAssignments([])
        setRequests([])
        setErrorType('invalid-token')
        setErrorMessage(message)
    }, [])

    const handleDisabledApi = useCallback(() => {
        setHealth(null)
        setNodes([])
        setAssignments([])
        setRequests([])
        setErrorType('disabled')
        setErrorMessage('Admin API отключен. Задайте TOPOR_BALANCER_ADMIN_TOKEN на backend.')
    }, [])

    const saveToken = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        const trimmedToken = tokenInput.trim()

        if (!trimmedToken) {
            return
        }

        localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmedToken)
        setAdminToken(trimmedToken)
        setTokenInput('')
        setErrorType(null)
        setErrorMessage('')
    }

    const logout = () => {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
        setAdminToken(null)
        setHealth(null)
        setNodes([])
        setAssignments([])
        setRequests([])
        setTokenInput('')
        setErrorType(null)
        setErrorMessage('')
    }

    const fetchAdminJson = useCallback(
        async <ResponseBody,>(url: string, options?: RequestInit): Promise<null | ResponseBody> => {
            if (!adminToken) {
                return null
            }

            const response = await fetch(url, {
                ...options,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
                    ...options?.headers
                }
            })

            if (response.status === 401 || response.status === 403) {
                handleAuthFailure()
                return null
            }

            if (response.status === 404) {
                handleDisabledApi()
                return null
            }

            if (!response.ok) {
                throw new Error(`Admin API request failed with status ${response.status}`)
            }

            const responseContentType = response.headers.get('content-type') || ''

            if (!responseContentType.toLowerCase().includes('application/json')) {
                handleDisabledApi()
                return null
            }

            return (await response.json()) as ResponseBody
        },
        [adminToken, handleAuthFailure, handleDisabledApi]
    )

    const loadHealth = useCallback(async () => {
        if (!adminToken) {
            return
        }

        setIsHealthLoading(true)
        setErrorType(null)
        setErrorMessage('')

        try {
            const responseBody = await fetchAdminJson<unknown>(ADMIN_HEALTH_URL)

            if (responseBody === null) {
                return
            }

            if (!isToporBalancerHealth(responseBody)) {
                setErrorType('unknown')
                setErrorMessage('Admin API вернул неожиданный ответ статуса')
                return
            }

            setHealth(responseBody)
        } catch (error) {
            const status = getResponseStatus(error)

            setHealth(null)

            if (status === 401 || status === 403) {
                handleAuthFailure()
                return
            }

            setErrorType('unknown')
            setErrorMessage('Не удалось загрузить статус TopoR Balancer')
            notifications.show({
                color: 'red',
                message: 'Не удалось загрузить статус TopoR Balancer',
                title: 'Ошибка Admin API'
            })
        } finally {
            setIsHealthLoading(false)
        }
    }, [adminToken, fetchAdminJson, handleAuthFailure])

    const loadNodes = useCallback(async () => {
        if (!adminToken) {
            return
        }

        setIsNodesLoading(true)

        try {
            const responseBody = await fetchAdminJson<unknown>(ADMIN_NODES_URL)

            if (responseBody === null) {
                return
            }

            if (!isToporBalancerNodes(responseBody)) {
                setNodes([])
                setErrorType('unknown')
                setErrorMessage('Admin API вернул неожиданный список нод')
                return
            }

            setNodes(responseBody)
        } catch (error) {
            const status = getResponseStatus(error)

            if (status === 401 || status === 403) {
                handleAuthFailure()
                return
            }

            setNodes([])
            notifications.show({
                color: 'red',
                message: 'Не удалось загрузить ноды TopoR Balancer',
                title: 'Ошибка Admin API'
            })
        } finally {
            setIsNodesLoading(false)
        }
    }, [adminToken, fetchAdminJson, handleAuthFailure])

    const loadAssignments = useCallback(async () => {
        if (!adminToken) {
            return
        }

        setIsAssignmentsLoading(true)

        try {
            const responseBody = await fetchAdminJson<unknown>(ADMIN_ASSIGNMENTS_URL)

            if (responseBody === null) {
                return
            }

            if (!isToporBalancerAssignments(responseBody)) {
                setAssignments([])
                setErrorType('unknown')
                setErrorMessage('Admin API вернул неожиданный список назначений')
                return
            }

            setAssignments(responseBody.slice(0, MAX_ASSIGNMENTS_DISPLAY))
        } catch (error) {
            const status = getResponseStatus(error)

            if (status === 401 || status === 403) {
                handleAuthFailure()
                return
            }

            setAssignments([])
            notifications.show({
                color: 'red',
                message: 'Не удалось загрузить назначения TopoR Balancer',
                title: 'Ошибка Admin API'
            })
        } finally {
            setIsAssignmentsLoading(false)
        }
    }, [adminToken, fetchAdminJson, handleAuthFailure])

    const loadRequests = useCallback(async () => {
        if (!adminToken) {
            return
        }

        setIsRequestsLoading(true)
        setRequestsErrorMessage('')

        try {
            const responseBody = await fetchAdminJson<unknown>(ADMIN_REQUESTS_URL)

            if (responseBody === null) {
                return
            }

            if (!isToporBalancerRequests(responseBody)) {
                setRequests([])
                setRequestsErrorMessage('Admin API вернул неожиданный список запросов')
                return
            }

            setRequests(responseBody.slice(0, MAX_REQUESTS_DISPLAY))
        } catch (error) {
            const status = getResponseStatus(error)

            if (status === 401 || status === 403) {
                handleAuthFailure()
                return
            }

            setRequests([])
            setRequestsErrorMessage('Не удалось загрузить запросы TopoR Balancer')
            notifications.show({
                color: 'red',
                message: 'Не удалось загрузить запросы TopoR Balancer',
                title: 'Ошибка Admin API'
            })
        } finally {
            setIsRequestsLoading(false)
        }
    }, [adminToken, fetchAdminJson, handleAuthFailure])

    const refreshAdminData = useCallback(async () => {
        await Promise.all([loadHealth(), loadNodes(), loadAssignments(), loadRequests()])
    }, [loadAssignments, loadHealth, loadNodes, loadRequests])

    useEffect(() => {
        if (adminToken) {
            refreshAdminData()
        }
    }, [adminToken, refreshAdminData])

    const filteredNodes = useMemo(() => {
        const normalizedSearch = searchValue.trim().toLowerCase()

        return nodes.filter((node) => {
            const matchesSearch =
                !normalizedSearch ||
                node.technicalHostName.toLowerCase().includes(normalizedSearch) ||
                node.publicName.toLowerCase().includes(normalizedSearch)

            return (
                matchesSearch &&
                (!statusFilter || node.status === statusFilter) &&
                (!planCodeFilter || node.planCode === planCodeFilter) &&
                (!publicHostCodeFilter || node.publicHostCode === publicHostCodeFilter)
            )
        })
    }, [nodes, planCodeFilter, publicHostCodeFilter, searchValue, statusFilter])

    const nodeById = useMemo(
        () => new Map(nodes.map((node) => [node.id, node])),
        [nodes]
    )
    const nodeByTechnicalHostName = useMemo(
        () => new Map(nodes.map((node) => [node.technicalHostName, node])),
        [nodes]
    )
    const getAssignmentNode = useCallback(
        (assignment: ToporBalancerAssignment) =>
            nodeById.get(assignment.nodeId) ||
            (assignment.technicalHostName ? nodeByTechnicalHostName.get(assignment.technicalHostName) : undefined),
        [nodeById, nodeByTechnicalHostName]
    )

    const filteredAssignments = useMemo(() => {
        const normalizedShortUuid = assignmentShortUuidFilter.trim().toLowerCase()
        const normalizedNodeFilter = assignmentNodeFilter.trim().toLowerCase()

        return assignments.filter((assignment) => {
            const assignmentNode = getAssignmentNode(assignment)
            const technicalHostName = assignment.technicalHostName || assignmentNode?.technicalHostName || ''
            const matchesShortUuid =
                !normalizedShortUuid || assignment.shortUuid.toLowerCase().includes(normalizedShortUuid)
            const matchesNode =
                !normalizedNodeFilter ||
                assignment.nodeId.toLowerCase().includes(normalizedNodeFilter) ||
                technicalHostName.toLowerCase().includes(normalizedNodeFilter)

            return (
                matchesShortUuid &&
                matchesNode &&
                (!assignmentPublicHostCodeFilter ||
                    assignment.publicHostCode === assignmentPublicHostCodeFilter) &&
                (!assignmentPlanCodeFilter || assignment.planCode === assignmentPlanCodeFilter)
            )
        })
    }, [
        assignmentNodeFilter,
        assignmentPlanCodeFilter,
        assignmentPublicHostCodeFilter,
        assignmentShortUuidFilter,
        assignments,
        getAssignmentNode
    ])

    const planCodeOptions = useMemo(() => selectOptions(nodes.map((node) => node.planCode)), [nodes])
    const publicHostCodeOptions = useMemo(
        () => selectOptions(nodes.map((node) => node.publicHostCode)),
        [nodes]
    )
    const assignmentPlanCodeOptions = useMemo(
        () => selectOptions(assignments.map((assignment) => assignment.planCode)),
        [assignments]
    )
    const assignmentPublicHostCodeOptions = useMemo(
        () => selectOptions(assignments.map((assignment) => assignment.publicHostCode)),
        [assignments]
    )
    const requestResponseFormatOptions = useMemo(
        () => selectOptions(requests.map((request) => request.responseFormat || 'unknown')),
        [requests]
    )
    const requestStatusOptions = useMemo(
        () => selectOptions(requests.map((request) => request.status || 'unknown')),
        [requests]
    )
    const nodeStatusOptions = useMemo(
        () =>
            NODE_STATUSES.map((status) => ({
                label: status,
                value: status
            })),
        []
    )

    const filteredRequests = useMemo(() => {
        const normalizedShortUuid = requestShortUuidFilter.trim().toLowerCase()

        return requests.filter((request) => {
            const responseFormat = request.responseFormat || 'unknown'
            const status = request.status || 'unknown'

            return (
                (!normalizedShortUuid || request.shortUuid.toLowerCase().includes(normalizedShortUuid)) &&
                (!requestResponseFormatFilter || responseFormat === requestResponseFormatFilter) &&
                (!requestStatusFilter || status === requestStatusFilter)
            )
        })
    }, [requestResponseFormatFilter, requestShortUuidFilter, requestStatusFilter, requests])

    const statusCards = useMemo(() => {
        if (!health) {
            return []
        }

        return [
            {
                color: health.enabled ? 'green' : 'gray',
                label: 'Включен',
                value: health.enabled ? 'Да' : 'Нет'
            },
            {
                color: health.assignmentMode === 'database' ? 'cyan' : 'blue',
                label: 'Режим назначений',
                value: health.assignmentMode
            },
            {
                color: health.configLoaded ? 'green' : 'gray',
                label: 'JSON-конфиг',
                value: health.configLoaded ? 'Да' : 'Нет'
            },
            {
                color: health.databaseConnected ? 'green' : 'red',
                label: 'База данных',
                value: health.databaseConnected ? 'Подключена' : 'Недоступна'
            },
            {
                color: 'violet',
                label: 'Ноды',
                value: health.nodeCount.toString()
            },
            {
                color: 'orange',
                label: 'Назначения',
                value: health.assignmentCount.toString()
            },
            ...(health.requestCount !== undefined
                ? [
                    {
                        color: 'teal',
                        label: 'Запросы',
                        value: health.requestCount.toString()
                    }
                ]
                : []),
            ...(health.lastError
                ? [
                    {
                        color: 'red',
                        label: 'Последняя ошибка',
                        value: health.lastError
                    }
                ]
                : [])
        ]
    }, [health])

    const resetNodeForm = () => {
        setEditForm({
            locationCode: '',
            maxUsers: 300,
            planCode: 'standard',
            publicHostCode: '',
            publicName: '',
            status: 'active',
            technicalHostName: '',
            weight: 1
        })
    }

    const openCreateNodeModal = () => {
        resetNodeForm()
        setIsCreateNodeModalOpen(true)
    }

    const closeCreateNodeModal = () => {
        setIsCreateNodeModalOpen(false)
        resetNodeForm()
    }

    const openEditModal = (node: ToporBalancerNode) => {
        setEditingNode(node)
        setEditForm({
            locationCode: node.locationCode || '',
            maxUsers: node.maxUsers,
            planCode: node.planCode,
            publicHostCode: node.publicHostCode,
            publicName: node.publicName,
            status: node.status,
            technicalHostName: node.technicalHostName,
            weight: node.weight
        })
    }

    const closeEditModal = () => {
        setEditingNode(null)
    }

    const getValidatedNodePayload = () => {
        const technicalHostName = editForm.technicalHostName.trim()
        const publicHostCode = editForm.publicHostCode.trim()
        const publicName = editForm.publicName.trim()
        const locationCode = editForm.locationCode.trim()
        const planCode = editForm.planCode.trim()

        if (!technicalHostName || !publicHostCode || !publicName || !planCode) {
            notifications.show({
                color: 'red',
                message: 'technicalHostName, publicHostCode, publicName and planCode are required',
                title: 'Invalid node values'
            })
            return null
        }

        if (editForm.weight <= 0) {
            notifications.show({
                color: 'red',
                message: 'Weight must be greater than 0',
                title: 'Invalid node values'
            })
            return null
        }

        if (editForm.maxUsers < 1) {
            notifications.show({
                color: 'red',
                message: 'Max users must be at least 1',
                title: 'Invalid node values'
            })
            return null
        }

        return {
            locationCode: locationCode || undefined,
            maxUsers: editForm.maxUsers,
            planCode,
            publicHostCode,
            publicName,
            status: editForm.status,
            technicalHostName,
            weight: editForm.weight
        }
    }

    const executeNodeStatusAction = async (
        node: ToporBalancerNode,
        action: 'disable' | 'drain' | 'enable'
    ) => {
        setIsNodeActionLoading(true)

        try {
            await fetchAdminJson<unknown>(`${ADMIN_NODES_URL}/${node.id}/${action}`, {
                method: 'POST'
            })

            await refreshAdminData()
            notifications.show({
                color: 'green',
                message: `${node.technicalHostName} updated`,
                title: 'Node status changed'
            })
        } catch {
            notifications.show({
                color: 'red',
                message: `Unable to update ${node.technicalHostName}`,
                title: 'Node action failed'
            })
        } finally {
            setIsNodeActionLoading(false)
        }
    }

    const runNodeStatusAction = async (
        node: ToporBalancerNode,
        action: 'disable' | 'drain' | 'enable'
    ) => {
        if (action === 'disable') {
            setPendingDisableNode(node)
            return
        }

        await executeNodeStatusAction(node, action)
    }

    const confirmDisableNode = async () => {
        if (!pendingDisableNode) {
            return
        }

        const node = pendingDisableNode

        setPendingDisableNode(null)
        await executeNodeStatusAction(node, 'disable')
    }

    const openReassignModal = (assignment: ToporBalancerAssignment) => {
        const assignmentNode = getAssignmentNode(assignment)
        const currentTechnicalHostName = assignment.technicalHostName || assignmentNode?.technicalHostName || null

        setPendingReassignAssignment(assignment)
        setTargetTechnicalHostName(currentTechnicalHostName)
    }

    const closeReassignModal = () => {
        setPendingReassignAssignment(null)
        setTargetTechnicalHostName(null)
    }

    const activeReassignTargetOptions = useMemo(() => {
        if (!pendingReassignAssignment) {
            return []
        }

        return nodes
            .filter(
                (node) =>
                    node.status === 'active' &&
                    node.publicHostCode === pendingReassignAssignment.publicHostCode &&
                    node.planCode === pendingReassignAssignment.planCode
            )
            .map((node) => ({
                label: `${node.technicalHostName} (${node.assignedUsers}/${node.maxUsers})`,
                value: node.technicalHostName
            }))
    }, [nodes, pendingReassignAssignment])

    const confirmReassignAssignment = async () => {
        if (!pendingReassignAssignment || !targetTechnicalHostName) {
            return
        }

        const targetNode = nodes.find(
            (node) =>
                node.technicalHostName === targetTechnicalHostName &&
                node.status === 'active' &&
                node.publicHostCode === pendingReassignAssignment.publicHostCode &&
                node.planCode === pendingReassignAssignment.planCode
        )

        if (!targetNode) {
            notifications.show({
                color: 'red',
                message: 'Target node must be active and match the same publicHostCode and planCode',
                title: 'Invalid reassignment'
            })
            return
        }

        setIsAssignmentActionLoading(true)

        try {
            await fetchAdminJson<unknown>(ADMIN_REASSIGN_URL, {
                body: JSON.stringify({
                    planCode: pendingReassignAssignment.planCode,
                    publicHostCode: pendingReassignAssignment.publicHostCode,
                    shortUuid: pendingReassignAssignment.shortUuid,
                    technicalHostName: targetTechnicalHostName
                }),
                method: 'POST'
            })

            closeReassignModal()
            await refreshAdminData()
            notifications.show({
                color: 'green',
                message: `${pendingReassignAssignment.shortUuid} reassigned to ${targetTechnicalHostName}`,
                title: 'Assignment updated'
            })
        } catch {
            notifications.show({
                color: 'red',
                message: `Unable to reassign ${pendingReassignAssignment.shortUuid}`,
                title: 'Reassign failed'
            })
        } finally {
            setIsAssignmentActionLoading(false)
        }
    }

    const saveNodeEdit = async () => {
        if (!editingNode) {
            return
        }

        const payload = getValidatedNodePayload()

        if (!payload) {
            return
        }

        setIsNodeActionLoading(true)

        try {
            await fetchAdminJson<unknown>(`${ADMIN_NODES_URL}/${editingNode.id}`, {
                body: JSON.stringify(payload),
                method: 'PATCH'
            })

            closeEditModal()
            await refreshAdminData()
            notifications.show({
                color: 'green',
                message: `${editingNode.technicalHostName} updated`,
                title: 'Node saved'
            })
        } catch {
            notifications.show({
                color: 'red',
                message: `Unable to save ${editingNode.technicalHostName}`,
                title: 'Node save failed'
            })
        } finally {
            setIsNodeActionLoading(false)
        }
    }

    const createNode = async () => {
        const payload = getValidatedNodePayload()

        if (!payload) {
            return
        }

        setIsNodeActionLoading(true)

        try {
            await fetchAdminJson<unknown>(ADMIN_NODES_URL, {
                body: JSON.stringify(payload),
                method: 'POST'
            })

            closeCreateNodeModal()
            await refreshAdminData()
            notifications.show({
                color: 'green',
                message: `${payload.technicalHostName} created`,
                title: 'Node added'
            })
        } catch {
            notifications.show({
                color: 'red',
                message: `Unable to create ${payload.technicalHostName}`,
                title: 'Node create failed'
            })
        } finally {
            setIsNodeActionLoading(false)
        }
    }

    const confirmDeleteNode = async () => {
        if (!pendingDeleteNode) {
            return
        }

        const node = pendingDeleteNode

        setIsNodeActionLoading(true)

        try {
            await fetchAdminJson<unknown>(`${ADMIN_NODES_URL}/${node.id}`, {
                method: 'DELETE'
            })

            setPendingDeleteNode(null)
            await refreshAdminData()
            notifications.show({
                color: 'green',
                message: `${node.technicalHostName} deleted`,
                title: 'Node deleted'
            })
        } catch {
            notifications.show({
                color: 'red',
                message: `Unable to delete ${node.technicalHostName}. Nodes with assignments cannot be deleted.`,
                title: 'Node delete failed'
            })
        } finally {
            setIsNodeActionLoading(false)
        }
    }

    return (
        <Page>
            <Container maw={1400} px={{ base: 'md', sm: 'lg', md: 'xl' }} py="xl">
                <Stack gap="lg">
                    <Group justify="space-between">
                        <Group gap="sm">
                            <IconDatabase className={classes.titleIcon} size={28} />
                            <div>
                                <Title order={2}>{t.admin.title}</Title>
                                <Text c="dimmed" size="sm">
                                    {t.admin.subtitle}
                                </Text>
                            </div>
                        </Group>

                        {isLoggedIn && (
                            <Group gap="sm">
                                <Button
                                    leftSection={<IconRefresh size={16} />}
                                    loading={isLoading}
                                    onClick={refreshAdminData}
                                    variant="light"
                                >
                                    {t.admin.refresh}
                                </Button>
                                <Button
                                    color="red"
                                    leftSection={<IconLogout size={16} />}
                                    onClick={logout}
                                    variant="subtle"
                                >
                                    {t.admin.logout}
                                </Button>
                            </Group>
                        )}
                    </Group>

                    {errorMessage && (
                        <Alert
                            color={errorType === 'invalid-token' ? 'red' : 'yellow'}
                            icon={<IconAlertTriangle size={18} />}
                            variant="light"
                        >
                            {errorMessage}
                        </Alert>
                    )}

                    {!isLoggedIn && (
                        <Card className={classes.loginCard} p="lg" radius="md">
                            <form onSubmit={saveToken}>
                                <Stack gap="md">
                                    <Group gap="sm">
                                        <IconShieldLock size={22} />
                                        <Title order={4}>{t.admin.tokenTitle}</Title>
                                    </Group>

                                    <PasswordInput
                                        autoComplete="current-password"
                                        label={t.admin.tokenLabel}
                                        onChange={(event) => setTokenInput(event.currentTarget.value)}
                                        placeholder={t.admin.tokenPlaceholder}
                                        value={tokenInput}
                                    />

                                    <Button loading={isLoading} type="submit">
                                        {t.admin.signIn}
                                    </Button>
                                </Stack>
                            </form>
                        </Card>
                    )}

                    {isLoggedIn && health && (
                        <Stack gap="lg">
                            <Group gap="sm">
                                <Badge color={health.enabled ? 'green' : 'gray'} variant="light">
                                    {health.enabled ? 'Включен' : 'Отключен'}
                                </Badge>
                                <Badge color="cyan" variant="light">
                                    {health.assignmentMode}
                                </Badge>
                            </Group>

                            <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="md">
                                {statusCards.map((card) => (
                                    <Card className={classes.statusCard} key={card.label} p="lg" radius="md">
                                        <Stack gap={6}>
                                            <Text c="dimmed" size="sm">
                                                {card.label}
                                            </Text>
                                            <Text c={card.color} className={classes.statusValue} fw={700}>
                                                {card.value}
                                            </Text>
                                        </Stack>
                                    </Card>
                                ))}
                            </SimpleGrid>
                        </Stack>
                    )}

                    {isLoggedIn && (
                        <Tabs defaultValue="nodes">
                            <Tabs.List>
                                <Tabs.Tab value="nodes">{t.admin.nodes}</Tabs.Tab>
                                {showAdvanced && <Tabs.Tab value="assignments">{t.admin.assignments}</Tabs.Tab>}
                                {showAdvanced && <Tabs.Tab value="requests">{t.admin.requests}</Tabs.Tab>}
                            </Tabs.List>

                            <Tabs.Panel pt="md" value="nodes">
                                <Stack gap="md">
                                    <Group justify="space-between">
                                        <div>
                                            <Title order={3}>{t.admin.nodes}</Title>
                                            <Text c="dimmed" size="sm">
                                                {filteredNodes.length} из {nodes.length} нод
                                            </Text>
                                        </div>
                                        <Group gap="sm">
                                            <Switch
                                                checked={showAdvanced}
                                                label={t.admin.advancedSettings}
                                                onChange={(event) => setShowAdvanced(event.currentTarget.checked)}
                                            />
                                            <Button
                                                leftSection={<IconPlus size={16} />}
                                                onClick={openCreateNodeModal}
                                            >
                                                {t.admin.addNode}
                                            </Button>
                                        </Group>
                                    </Group>

                                    <SimpleGrid cols={{ base: 1, md: showAdvanced ? 4 : 2 }} spacing="md">
                                        <Alert color="blue" variant="light">
                                            <Text fw={700}>Sticky Assignment</Text>
                                            <Text size="sm">{t.balancingHelp.stickyAssignment}</Text>
                                        </Alert>
                                        <Alert color="cyan" variant="light">
                                            <Text fw={700}>Weighted Balancing</Text>
                                            <Text size="sm">{t.balancingHelp.weightedBalancing}</Text>
                                        </Alert>
                                        {showAdvanced && (
                                            <Alert color="green" variant="light">
                                                <Text fw={700}>Health Checks</Text>
                                                <Text size="sm">{t.balancingHelp.healthChecks}</Text>
                                            </Alert>
                                        )}
                                        {showAdvanced && (
                                            <Alert color="yellow" variant="light">
                                                <Text fw={700}>Failover</Text>
                                                <Text size="sm">{t.balancingHelp.failover}</Text>
                                            </Alert>
                                        )}
                                    </SimpleGrid>

                                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
                                        <TextInput
                                            label={t.admin.search}
                                            onChange={(event) => setSearchValue(event.currentTarget.value)}
                                            placeholder="технический хост или публичное имя"
                                            value={searchValue}
                                        />
                                        <Select
                                            clearable
                                            data={nodeStatusOptions}
                                            label={t.admin.status}
                                            onChange={setStatusFilter}
                                            placeholder="Все статусы"
                                            value={statusFilter}
                                        />
                                        <Select
                                            clearable
                                            data={planCodeOptions}
                                            label={t.admin.planCode}
                                            onChange={setPlanCodeFilter}
                                            placeholder="Все тарифы"
                                            value={planCodeFilter}
                                        />
                                        <Select
                                            clearable
                                            data={publicHostCodeOptions}
                                            label={t.admin.publicHost}
                                            onChange={setPublicHostCodeFilter}
                                            placeholder="Все публичные хосты"
                                            value={publicHostCodeFilter}
                                        />
                                    </SimpleGrid>

                                    <Card className={classes.tableCard} p={0} radius="md">
                                        {filteredNodes.length === 0 ? (
                                            <Stack align="center" className={classes.emptyState} gap={6}>
                                                <Text fw={700}>Добавьте первую группу/ноду</Text>
                                                <Text c="dimmed" size="sm">
                                                    Create a node in database mode or clear filters if nodes already exist.
                                                </Text>
                                                <Button leftSection={<IconPlus size={16} />} onClick={openCreateNodeModal}>
                                                    Add node
                                                </Button>
                                            </Stack>
                                        ) : (
                                            <ScrollArea>
                                                <Table className={classes.nodesTable} highlightOnHover stickyHeader>
                                                    <Table.Thead>
                                                        <Table.Tr>
                                                            <Table.Th>
                                                                <Group gap={4} wrap="nowrap">
                                                                    publicHostCode
                                                                    <Help label={t.balancingHelp.publicHostCode} />
                                                                </Group>
                                                            </Table.Th>
                                                            <Table.Th>publicName</Table.Th>
                                                            <Table.Th>
                                                                <Group gap={4} wrap="nowrap">
                                                                    technicalHostName
                                                                    <Help label={t.balancingHelp.technicalHostName} />
                                                                </Group>
                                                            </Table.Th>
                                                            {showAdvanced && <Table.Th>locationCode</Table.Th>}
                                                            <Table.Th>planCode</Table.Th>
                                                            <Table.Th>
                                                                <Group gap={4} wrap="nowrap">
                                                                    status
                                                                    <Help label={t.balancingHelp.healthChecks} />
                                                                </Group>
                                                            </Table.Th>
                                                            {showAdvanced && (
                                                                <Table.Th>
                                                                    <Group gap={4} wrap="nowrap">
                                                                        weight
                                                                        <Help label={t.balancingHelp.nodeWeight} />
                                                                    </Group>
                                                                </Table.Th>
                                                            )}
                                                            {showAdvanced && (
                                                                <Table.Th>
                                                                    <Group gap={4} wrap="nowrap">
                                                                        maxUsers
                                                                        <Help label={t.balancingHelp.maxUsers} />
                                                                    </Group>
                                                                </Table.Th>
                                                            )}
                                                            <Table.Th>assignedUsers</Table.Th>
                                                            <Table.Th>load</Table.Th>
                                                            {showAdvanced && <Table.Th>updatedAt</Table.Th>}
                                                            <Table.Th>действия</Table.Th>
                                                        </Table.Tr>
                                                    </Table.Thead>
                                                    <Table.Tbody>
                                                        {filteredNodes.map((node) => {
                                                            const loadPercent = getLoadPercent(node)
                                                            const isOverloaded = loadPercent >= 100

                                                            return (
                                                                <Table.Tr
                                                                    className={classes[`row-${node.status}`]}
                                                                    key={node.id}
                                                                >
                                                                    <Table.Td>{node.publicHostCode}</Table.Td>
                                                                    <Table.Td>{node.publicName}</Table.Td>
                                                                    <Table.Td>{node.technicalHostName}</Table.Td>
                                                                    {showAdvanced && <Table.Td>{node.locationCode || '-'}</Table.Td>}
                                                                    <Table.Td>{node.planCode}</Table.Td>
                                                                    <Table.Td>
                                                                        <Badge
                                                                            color={getStatusColor(node.status)}
                                                                            variant="light"
                                                                        >
                                                                            {node.status}
                                                                        </Badge>
                                                                    </Table.Td>
                                                                    {showAdvanced && <Table.Td>{node.weight}</Table.Td>}
                                                                    {showAdvanced && <Table.Td>{node.maxUsers}</Table.Td>}
                                                                    <Table.Td>{node.assignedUsers}</Table.Td>
                                                                    <Table.Td>
                                                                        <Badge
                                                                            color={isOverloaded ? 'red' : 'blue'}
                                                                            variant="light"
                                                                        >
                                                                            {loadPercent}%
                                                                        </Badge>
                                                                    </Table.Td>
                                                                    {showAdvanced && <Table.Td>{formatDate(node.updatedAt)}</Table.Td>}
                                                                    <Table.Td>
                                                                        <Group gap={6} wrap="nowrap">
                                                                            <Button
                                                                                disabled={node.status === 'active'}
                                                                                loading={isNodeActionLoading}
                                                                                onClick={() =>
                                                                                    runNodeStatusAction(node, 'enable')
                                                                                }
                                                                                size="xs"
                                                                                variant="light"
                                                                            >
                                                                                Включить
                                                                            </Button>
                                                                            <Button
                                                                                color="yellow"
                                                                                disabled={node.status === 'draining'}
                                                                                loading={isNodeActionLoading}
                                                                                onClick={() =>
                                                                                    runNodeStatusAction(node, 'drain')
                                                                                }
                                                                                size="xs"
                                                                                variant="light"
                                                                            >
                                                                                Draining
                                                                            </Button>
                                                                            <Button
                                                                                color="red"
                                                                                disabled={node.status === 'disabled'}
                                                                                loading={isNodeActionLoading}
                                                                                onClick={() =>
                                                                                    runNodeStatusAction(node, 'disable')
                                                                                }
                                                                                size="xs"
                                                                                variant="light"
                                                                            >
                                                                                Отключить
                                                                            </Button>
                                                                            <Button
                                                                                leftSection={<IconEdit size={14} />}
                                                                                onClick={() => openEditModal(node)}
                                                                                size="xs"
                                                                                variant="subtle"
                                                                            >
                                                                                Изменить
                                                                            </Button>
                                                                            <Button
                                                                                color="red"
                                                                                disabled={node.assignedUsers > 0}
                                                                                leftSection={<IconTrash size={14} />}
                                                                                onClick={() => setPendingDeleteNode(node)}
                                                                                size="xs"
                                                                                variant="subtle"
                                                                            >
                                                                                Удалить
                                                                            </Button>
                                                                        </Group>
                                                                    </Table.Td>
                                                                </Table.Tr>
                                                            )
                                                        })}
                                                    </Table.Tbody>
                                                </Table>
                                            </ScrollArea>
                                        )}
                                    </Card>
                                </Stack>
                            </Tabs.Panel>

                            <Tabs.Panel pt="md" value="assignments">
                                <Stack gap="md">
                                    <Group justify="space-between">
                                        <div>
                                            <Title order={3}>Assignments</Title>
                                            <Text c="dimmed" size="sm">
                                                {filteredAssignments.length} of {assignments.length} assignments
                                            </Text>
                                        </div>
                                        <Button
                                            leftSection={<IconRefresh size={16} />}
                                            loading={isAssignmentsLoading}
                                            onClick={loadAssignments}
                                            variant="light"
                                        >
                                            Refresh assignments
                                        </Button>
                                    </Group>

                                    <Alert color="yellow" icon={<IconAlertTriangle size={18} />} variant="light">
                                        Backend pagination is not available yet. Showing at most {MAX_ASSIGNMENTS_DISPLAY}{' '}
                                        newest assignments returned by the API.
                                    </Alert>

                                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
                                        <TextInput
                                            label="shortUuid"
                                            onChange={(event) =>
                                                setAssignmentShortUuidFilter(event.currentTarget.value)
                                            }
                                            placeholder="Filter by user"
                                            value={assignmentShortUuidFilter}
                                        />
                                        <Select
                                            clearable
                                            data={assignmentPublicHostCodeOptions}
                                            label="publicHostCode"
                                            onChange={setAssignmentPublicHostCodeFilter}
                                            placeholder="All public hosts"
                                            value={assignmentPublicHostCodeFilter}
                                        />
                                        <Select
                                            clearable
                                            data={assignmentPlanCodeOptions}
                                            label="planCode"
                                            onChange={setAssignmentPlanCodeFilter}
                                            placeholder="All plans"
                                            value={assignmentPlanCodeFilter}
                                        />
                                        <TextInput
                                            label="technicalHostName / nodeId"
                                            onChange={(event) => setAssignmentNodeFilter(event.currentTarget.value)}
                                            placeholder="Filter by node"
                                            value={assignmentNodeFilter}
                                        />
                                    </SimpleGrid>

                                    <Card className={classes.tableCard} p={0} radius="md">
                                        {filteredAssignments.length === 0 ? (
                                            <Stack align="center" className={classes.emptyState} gap={6}>
                                                <Text fw={700}>No assignments found</Text>
                                                <Text c="dimmed" size="sm">
                                                    Adjust filters or refresh the Admin API data.
                                                </Text>
                                            </Stack>
                                        ) : (
                                            <ScrollArea>
                                                <Table className={classes.assignmentsTable} highlightOnHover stickyHeader>
                                                    <Table.Thead>
                                                        <Table.Tr>
                                                            <Table.Th>shortUuid</Table.Th>
                                                            <Table.Th>publicHostCode</Table.Th>
                                                            <Table.Th>planCode</Table.Th>
                                                            <Table.Th>technicalHostName</Table.Th>
                                                            <Table.Th>publicName</Table.Th>
                                                            <Table.Th>createdAt</Table.Th>
                                                            <Table.Th>updatedAt</Table.Th>
                                                            <Table.Th>actions</Table.Th>
                                                        </Table.Tr>
                                                    </Table.Thead>
                                                    <Table.Tbody>
                                                        {filteredAssignments.map((assignment) => {
                                                            const assignmentNode = getAssignmentNode(assignment)
                                                            const technicalHostName =
                                                                assignment.technicalHostName ||
                                                                assignmentNode?.technicalHostName ||
                                                                '-'
                                                            const publicName = assignmentNode?.publicName || '-'
                                                            const activeTargets = nodes.filter(
                                                                (node) =>
                                                                    node.status === 'active' &&
                                                                    node.publicHostCode === assignment.publicHostCode &&
                                                                    node.planCode === assignment.planCode
                                                            )

                                                            return (
                                                                <Table.Tr key={assignment.id}>
                                                                    <Table.Td>{assignment.shortUuid}</Table.Td>
                                                                    <Table.Td>{assignment.publicHostCode}</Table.Td>
                                                                    <Table.Td>{assignment.planCode}</Table.Td>
                                                                    <Table.Td>{technicalHostName}</Table.Td>
                                                                    <Table.Td>{publicName}</Table.Td>
                                                                    <Table.Td>{formatDate(assignment.createdAt)}</Table.Td>
                                                                    <Table.Td>{formatDate(assignment.updatedAt)}</Table.Td>
                                                                    <Table.Td>
                                                                        <Button
                                                                            disabled={activeTargets.length === 0}
                                                                            leftSection={<IconSwitchHorizontal size={14} />}
                                                                            onClick={() => openReassignModal(assignment)}
                                                                            size="xs"
                                                                            variant="light"
                                                                        >
                                                                            Reassign
                                                                        </Button>
                                                                    </Table.Td>
                                                                </Table.Tr>
                                                            )
                                                        })}
                                                    </Table.Tbody>
                                                </Table>
                                            </ScrollArea>
                                        )}
                                    </Card>
                                </Stack>
                            </Tabs.Panel>

                            <Tabs.Panel pt="md" value="requests">
                                <Stack gap="md">
                                    <Group justify="space-between">
                                        <div>
                                            <Title order={3}>Requests</Title>
                                            <Text c="dimmed" size="sm">
                                                {filteredRequests.length} of {requests.length} requests
                                            </Text>
                                        </div>
                                        <Button
                                            leftSection={<IconRefresh size={16} />}
                                            loading={isRequestsLoading}
                                            onClick={loadRequests}
                                            variant="light"
                                        >
                                            Refresh requests
                                        </Button>
                                    </Group>

                                    {requestsErrorMessage && (
                                        <Alert
                                            color="red"
                                            icon={<IconAlertTriangle size={18} />}
                                            variant="light"
                                        >
                                            {requestsErrorMessage}
                                        </Alert>
                                    )}

                                    <Alert color="yellow" icon={<IconAlertTriangle size={18} />} variant="light">
                                        Request debug data is shown without subscription links, tokens, or full IP
                                        addresses. Text fields are defensively redacted in the UI.
                                    </Alert>

                                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                                        <TextInput
                                            label="shortUuid"
                                            onChange={(event) => setRequestShortUuidFilter(event.currentTarget.value)}
                                            placeholder="Filter by user"
                                            value={requestShortUuidFilter}
                                        />
                                        <Select
                                            clearable
                                            data={requestResponseFormatOptions}
                                            label="responseFormat"
                                            onChange={setRequestResponseFormatFilter}
                                            placeholder="All formats"
                                            value={requestResponseFormatFilter}
                                        />
                                        <Select
                                            clearable
                                            data={requestStatusOptions}
                                            label="status"
                                            onChange={setRequestStatusFilter}
                                            placeholder="All statuses"
                                            value={requestStatusFilter}
                                        />
                                    </SimpleGrid>

                                    <Card className={classes.tableCard} p={0} radius="md">
                                        {filteredRequests.length === 0 ? (
                                            <Stack align="center" className={classes.emptyState} gap={6}>
                                                <Text fw={700}>No requests found</Text>
                                                <Text c="dimmed" size="sm">
                                                    Adjust filters or refresh the Admin API data.
                                                </Text>
                                            </Stack>
                                        ) : (
                                            <ScrollArea>
                                                <Table className={classes.requestsTable} highlightOnHover stickyHeader>
                                                    <Table.Thead>
                                                        <Table.Tr>
                                                            <Table.Th>createdAt</Table.Th>
                                                            <Table.Th>shortUuid</Table.Th>
                                                            <Table.Th>userAgent</Table.Th>
                                                            <Table.Th>responseFormat</Table.Th>
                                                            <Table.Th>inputLinksCount</Table.Th>
                                                            <Table.Th>outputLinksCount</Table.Th>
                                                            <Table.Th>status</Table.Th>
                                                            <Table.Th>errorMessage</Table.Th>
                                                        </Table.Tr>
                                                    </Table.Thead>
                                                    <Table.Tbody>
                                                        {filteredRequests.map((request) => (
                                                            <Table.Tr key={request.id}>
                                                                <Table.Td>{formatDate(request.createdAt)}</Table.Td>
                                                                <Table.Td>{request.shortUuid}</Table.Td>
                                                                <Table.Td className={classes.wrapCell}>
                                                                    {redactSensitiveText(request.userAgent)}
                                                                </Table.Td>
                                                                <Table.Td>{request.responseFormat || 'unknown'}</Table.Td>
                                                                <Table.Td>{request.inputLinksCount ?? '-'}</Table.Td>
                                                                <Table.Td>{request.outputLinksCount ?? '-'}</Table.Td>
                                                                <Table.Td>{request.status || 'unknown'}</Table.Td>
                                                                <Table.Td className={classes.wrapCell}>
                                                                    {redactSensitiveText(request.errorMessage)}
                                                                </Table.Td>
                                                            </Table.Tr>
                                                        ))}
                                                    </Table.Tbody>
                                                </Table>
                                            </ScrollArea>
                                        )}
                                    </Card>
                                </Stack>
                            </Tabs.Panel>
                        </Tabs>
                    )}
                </Stack>
            </Container>

            <Modal centered onClose={closeCreateNodeModal} opened={isCreateNodeModalOpen} title="Add node">
                <Stack gap="md">
                    <TextInput
                        description={t.balancingHelp.technicalHostName}
                        label="technicalHostName"
                        onChange={(event) =>
                            setEditForm((current) => ({
                                ...current,
                                technicalHostName: event.currentTarget.value
                            }))
                        }
                        placeholder="FI-STD-01"
                        value={editForm.technicalHostName}
                    />
                    <TextInput
                        description={t.balancingHelp.publicHostCode}
                        label="publicHostCode"
                        onChange={(event) =>
                            setEditForm((current) => ({
                                ...current,
                                publicHostCode: event.currentTarget.value
                            }))
                        }
                        placeholder="fi_standard"
                        value={editForm.publicHostCode}
                    />
                    <TextInput
                        label="publicName"
                        onChange={(event) =>
                            setEditForm((current) => ({
                                ...current,
                                publicName: event.currentTarget.value
                            }))
                        }
                        placeholder="Finland"
                        value={editForm.publicName}
                    />
                    {showAdvanced && (
                        <TextInput
                            label="locationCode"
                            onChange={(event) =>
                                setEditForm((current) => ({
                                    ...current,
                                    locationCode: event.currentTarget.value
                                }))
                            }
                            placeholder="FI"
                            value={editForm.locationCode}
                        />
                    )}
                    <TextInput
                        label="planCode"
                        onChange={(event) =>
                            setEditForm((current) => ({
                                ...current,
                                planCode: event.currentTarget.value
                            }))
                        }
                        value={editForm.planCode}
                    />
                    <Select
                        description={t.balancingHelp.healthChecks}
                        data={nodeStatusOptions}
                        label="status"
                        onChange={(value) =>
                            setEditForm((current) => ({
                                ...current,
                                status: (value as ToporBalancerNodeStatus | null) || 'active'
                            }))
                        }
                        value={editForm.status}
                    />
                    <NumberInput
                        allowDecimal
                        decimalScale={4}
                        description={t.balancingHelp.nodeWeight}
                        label="weight"
                        min={0.0001}
                        onChange={(value) =>
                            setEditForm((current) => ({
                                ...current,
                                weight: typeof value === 'number' ? value : Number(value)
                            }))
                        }
                        value={editForm.weight}
                    />
                    <NumberInput
                        allowDecimal={false}
                        description={t.balancingHelp.maxUsers}
                        label="maxUsers"
                        min={1}
                        onChange={(value) =>
                            setEditForm((current) => ({
                                ...current,
                                maxUsers: typeof value === 'number' ? value : Number(value)
                            }))
                        }
                        value={editForm.maxUsers}
                    />

                    <Group justify="flex-end">
                        <Button onClick={closeCreateNodeModal} variant="subtle">
                            Cancel
                        </Button>
                        <Button loading={isNodeActionLoading} onClick={createNode}>
                            Create
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal centered onClose={closeEditModal} opened={Boolean(editingNode)} title="Edit node">
                <Stack gap="md">
                    {editingNode && (
                        <Text c="dimmed" size="sm">
                            {editingNode.technicalHostName}
                        </Text>
                    )}

                    <TextInput
                        description={t.balancingHelp.technicalHostName}
                        label="technicalHostName"
                        onChange={(event) =>
                            setEditForm((current) => ({
                                ...current,
                                technicalHostName: event.currentTarget.value
                            }))
                        }
                        value={editForm.technicalHostName}
                    />
                    <TextInput
                        description={t.balancingHelp.publicHostCode}
                        label="publicHostCode"
                        onChange={(event) =>
                            setEditForm((current) => ({
                                ...current,
                                publicHostCode: event.currentTarget.value
                            }))
                        }
                        value={editForm.publicHostCode}
                    />
                    <TextInput
                        label="publicName"
                        onChange={(event) =>
                            setEditForm((current) => ({
                                ...current,
                                publicName: event.currentTarget.value
                            }))
                        }
                        value={editForm.publicName}
                    />
                    {showAdvanced && (
                        <TextInput
                            label="locationCode"
                            onChange={(event) =>
                                setEditForm((current) => ({
                                    ...current,
                                    locationCode: event.currentTarget.value
                                }))
                            }
                            value={editForm.locationCode}
                        />
                    )}
                    <TextInput
                        label="planCode"
                        onChange={(event) =>
                            setEditForm((current) => ({
                                ...current,
                                planCode: event.currentTarget.value
                            }))
                        }
                        value={editForm.planCode}
                    />
                    <Select
                        description={t.balancingHelp.healthChecks}
                        data={nodeStatusOptions}
                        label="status"
                        onChange={(value) =>
                            setEditForm((current) => ({
                                ...current,
                                status: (value as ToporBalancerNodeStatus | null) || 'active'
                            }))
                        }
                        value={editForm.status}
                    />
                    <NumberInput
                        allowDecimal
                        decimalScale={4}
                        description={t.balancingHelp.nodeWeight}
                        label="weight"
                        min={0.0001}
                        onChange={(value) =>
                            setEditForm((current) => ({
                                ...current,
                                weight: typeof value === 'number' ? value : Number(value)
                            }))
                        }
                        value={editForm.weight}
                    />
                    <NumberInput
                        allowDecimal={false}
                        description={t.balancingHelp.maxUsers}
                        label="maxUsers"
                        min={1}
                        onChange={(value) =>
                            setEditForm((current) => ({
                                ...current,
                                maxUsers: typeof value === 'number' ? value : Number(value)
                            }))
                        }
                        value={editForm.maxUsers}
                    />

                    <Group justify="flex-end">
                        <Button onClick={closeEditModal} variant="subtle">
                            Cancel
                        </Button>
                        <Button loading={isNodeActionLoading} onClick={saveNodeEdit}>
                            Save
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                centered
                onClose={() => setPendingDeleteNode(null)}
                opened={Boolean(pendingDeleteNode)}
                title="Delete node"
            >
                <Stack gap="md">
                    <Text>
                        Delete node <strong>{pendingDeleteNode?.technicalHostName}</strong>?
                    </Text>
                    <Text c="dimmed" size="sm">
                        Nodes with assignments are rejected by the API and cannot be deleted.
                    </Text>
                    <Group justify="flex-end">
                        <Button onClick={() => setPendingDeleteNode(null)} variant="subtle">
                            Cancel
                        </Button>
                        <Button color="red" loading={isNodeActionLoading} onClick={confirmDeleteNode}>
                            Delete
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                centered
                onClose={() => setPendingDisableNode(null)}
                opened={Boolean(pendingDisableNode)}
                title="Disable node"
            >
                <Stack gap="md">
                    <Text>
                        Disable node <strong>{pendingDisableNode?.technicalHostName}</strong>?
                    </Text>
                    <Text c="dimmed" size="sm">
                        Existing users assigned to disabled or dead nodes can be reassigned by the balancer.
                    </Text>
                    <Group justify="flex-end">
                        <Button onClick={() => setPendingDisableNode(null)} variant="subtle">
                            Cancel
                        </Button>
                        <Button color="red" loading={isNodeActionLoading} onClick={confirmDisableNode}>
                            Disable
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                centered
                onClose={closeReassignModal}
                opened={Boolean(pendingReassignAssignment)}
                title="Manual reassignment"
            >
                <Stack gap="md">
                    {pendingReassignAssignment && (
                        <Stack gap={4}>
                            <Text>
                                Reassign <strong>{pendingReassignAssignment.shortUuid}</strong>
                            </Text>
                            <Text c="dimmed" size="sm">
                                {pendingReassignAssignment.publicHostCode} / {pendingReassignAssignment.planCode}
                            </Text>
                        </Stack>
                    )}

                    <Alert color="blue" icon={<IconAlertTriangle size={18} />} variant="light">
                        Only active nodes with the same publicHostCode and planCode are available.
                    </Alert>

                    <Select
                        data={activeReassignTargetOptions}
                        label="Target technicalHostName"
                        onChange={setTargetTechnicalHostName}
                        placeholder="Choose active target node"
                        value={targetTechnicalHostName}
                    />

                    <Group justify="flex-end">
                        <Button onClick={closeReassignModal} variant="subtle">
                            Cancel
                        </Button>
                        <Button
                            disabled={!targetTechnicalHostName}
                            leftSection={<IconSwitchHorizontal size={16} />}
                            loading={isAssignmentActionLoading}
                            onClick={confirmReassignAssignment}
                        >
                            Confirm reassignment
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Page>
    )
}
