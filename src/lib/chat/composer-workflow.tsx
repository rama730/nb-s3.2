import type { ReactNode } from 'react';
import {
    AlertTriangle,
    Clock,
    Loader2,
    UserCheck,
    UserPlus,
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
        };
    }

    // Active applications are now handled entirely by inline system cards, so we don't need a composer notice.

    if (capability.canSend) return null;

    if (capability.blocked) {
        return {
            tone: 'warning',
            badge: 'Messaging blocked',
            icon: <AlertTriangle className="h-4 w-4" />,
            title: 'Messaging is blocked in this conversation.',
            description: 'You can still review the conversation history here.',
            actionLabel: null,
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
        };
    }

    return {
        tone: 'brand',
        badge: 'Connect to message',
        icon: <UserPlus className="h-4 w-4" />,
        title: 'Connect with this user to start messaging.',
        description: 'Send a connection request to unlock direct replies in this thread.',
        actionLabel: 'Send request',
    };
}
