import type { ReactNode } from 'react';
import {
    AlertTriangle,
    Check,
    Clock,
    Loader2,
    UserCheck,
    UserPlus,
    X,
} from 'lucide-react';
import type { ConversationCapabilityV2 } from '@/app/actions/messaging/v2';

export type ComposerWorkflowTone = 'neutral' | 'brand' | 'warning' | 'success' | 'danger';

export interface ComposerWorkflowNotice {
    tone: ComposerWorkflowTone;
    badge: string;
    icon: ReactNode;
    title: string;
    description: string;
    actionLabel: string | null;
    requestHref: string | null;
    projectHref: string | null;
    canAccept: boolean;
    canReject: boolean;
    canWithdraw: boolean;
    canReopen: boolean;
    canEditRequest: boolean;
    lastStatusLabel: string | null;
}

export function canSendFromCapability(capability: ConversationCapabilityV2 | null) {
    return capability?.canSend === true && capability.activeApplicationStatus !== 'project_deleted';
}

export function getComposerWorkflowNotice(
    capability: ConversationCapabilityV2 | null,
): ComposerWorkflowNotice | null {
    if (!capability) {
        return {
            tone: 'neutral',
            badge: 'Permissions',
            icon: <Loader2 className="h-4 w-4 animate-spin" />,
            title: 'Checking messaging permissions…',
            description: 'Loading the latest conversation workflow state.',
            actionLabel: null,
            requestHref: null,
            projectHref: null,
            canAccept: false,
            canReject: false,
            canWithdraw: false,
            canReopen: false,
            canEditRequest: false,
            lastStatusLabel: null,
        };
    }

    if (capability.hasActiveApplication && capability.activeApplicationId) {
        const status = capability.activeApplicationStatus ?? 'pending';
        return {
            tone: status === 'accepted'
                ? 'success'
                : status === 'rejected'
                    ? 'danger'
                    : status === 'project_deleted'
                        ? 'warning'
                        : 'brand',
            badge: `Application ${status === 'project_deleted' ? 'Project deleted' : `${status[0].toUpperCase()}${status.slice(1)}`}`,
            icon: status === 'accepted'
                ? <Check className="h-4 w-4" />
                : status === 'rejected'
                    ? <X className="h-4 w-4" />
                    : status === 'project_deleted'
                        ? <AlertTriangle className="h-4 w-4" />
                        : <Clock className="h-4 w-4" />,
            title: status === 'accepted'
                ? capability.isApplicant
                    ? 'Your application was accepted and this thread is now collaborative.'
                    : 'This applicant is now part of the project.'
                : status === 'rejected'
                    ? capability.isApplicant
                        ? 'This application was closed. You can still review the history here.'
                        : 'This application was rejected. You can reopen it if needed.'
                    : status === 'project_deleted'
                        ? 'The related project was deleted, so this thread is now read-only context.'
                        : capability.isApplicant
                            ? 'Your application is still active in this thread.'
                            : 'This conversation still has an active application workflow.',
            description: status === 'pending'
                ? capability.isApplicant
                    ? 'You can edit or withdraw this request while it is pending.'
                    : 'Accept or reject this application directly from the conversation.'
                : status === 'accepted'
                    ? 'Project context and request history stay available here.'
                    : status === 'rejected'
                        ? 'The workflow is preserved in this thread for context.'
                        : 'Project deletion freezes this application thread for reference only.',
            actionLabel: null,
            requestHref: `/people?tab=requests#app-${capability.activeApplicationId}`,
            projectHref: status === 'accepted' && capability.activeProjectId
                ? `/projects/${capability.activeProjectId}`
                : null,
            canAccept: capability.isCreator === true && status === 'pending',
            canReject: capability.isCreator === true && status === 'pending',
            canWithdraw: capability.isApplicant === true && status === 'pending',
            canReopen: capability.isCreator === true && status === 'rejected',
            canEditRequest: capability.isApplicant === true && status === 'pending',
            lastStatusLabel: status === 'accepted'
                ? 'Accepted'
                : status === 'rejected'
                    ? 'Rejected'
                    : status === 'project_deleted'
                        ? 'Project deleted'
                        : 'Pending',
        };
    }

    if (capability.canSend) return null;

    if (capability.blocked) {
        return {
            tone: 'warning',
            badge: 'Messaging blocked',
            icon: <AlertTriangle className="h-4 w-4" />,
            title: 'Messaging is blocked in this conversation.',
            description: 'You can still review the conversation history here.',
            actionLabel: null,
            requestHref: null,
            projectHref: null,
            canAccept: false,
            canReject: false,
            canWithdraw: false,
            canReopen: false,
            canEditRequest: false,
            lastStatusLabel: null,
        };
    }

    if (capability.status === 'pending_received') {
        return {
            tone: 'warning',
            badge: 'Connection request',
            icon: <UserCheck className="h-4 w-4" />,
            title: 'Accept this connection request to reply.',
            description: 'Once accepted, this thread becomes fully interactive.',
            actionLabel: 'Accept request',
            requestHref: null,
            projectHref: null,
            canAccept: false,
            canReject: false,
            canWithdraw: false,
            canReopen: false,
            canEditRequest: false,
            lastStatusLabel: null,
        };
    }

    if (capability.status === 'pending_sent') {
        return {
            tone: 'warning',
            badge: 'Request pending',
            icon: <Clock className="h-4 w-4" />,
            title: 'Your connection request is pending.',
            description: 'You can cancel it or wait for them to accept before replying.',
            actionLabel: 'Cancel request',
            requestHref: null,
            projectHref: null,
            canAccept: false,
            canReject: false,
            canWithdraw: false,
            canReopen: false,
            canEditRequest: false,
            lastStatusLabel: null,
        };
    }

    return {
        tone: 'brand',
        badge: 'Connect to message',
        icon: <UserPlus className="h-4 w-4" />,
        title: 'Connect with this user to start messaging.',
        description: 'Send a connection request to unlock direct replies in this thread.',
        actionLabel: 'Send request',
        requestHref: null,
        projectHref: null,
        canAccept: false,
        canReject: false,
        canWithdraw: false,
        canReopen: false,
        canEditRequest: false,
        lastStatusLabel: null,
    };
}
