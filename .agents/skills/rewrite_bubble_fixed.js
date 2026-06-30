const fs = require('fs');

let fullCode = fs.readFileSync('/Users/chrama/Downloads/nb-s3/src/components/chat/v2/MessageBubbleV2.tsx', 'utf8');

// The exact string to replace in the imports
const oldImports = `    MessageAttachmentsV2,
    MessageTextContentV2,
    type ChatAttachmentV2,
} from './message-rendering';`;

const newImports = `    MessageAttachmentsV2,
    CodeSegmentV2,
    renderTextWithMentions,
    type ChatAttachmentV2,
} from './message-rendering';`;

fullCode = fullCode.replace(oldImports, newImports);

// Find exactly the start of the block
const startStr = "                            {hasTextBubbleContent ? (";
const endStr = "                                </div>\n                            ) : null}\n\n                        </motion.div>";

const startIndex = fullCode.indexOf(startStr);
const endIndex = fullCode.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
    console.error("Could not find boundaries!");
    process.exit(1);
}

// We will replace from startIndex to endIndex (exclusive of endIndex string, so we will append it or replace it)
const replacement = `                            {hasTextBubbleContent ? (
                                isEditing ? (
                                    <div
                                        className={cn(
                                            'msg-bubble-shell',
                                            isOwn ? 'msg-bubble-own' : 'msg-bubble-peer',
                                            (onlyEmojis || isApplication || isCodeOnlyContent) ? '!bg-transparent !bg-none !border-0 !shadow-none !p-0' : cn(
                                                isOwn ? cn('rounded-2xl', isConsecutiveFromPrev && 'rounded-tr-sm', isConsecutiveToNext && 'rounded-br-sm') : cn('rounded-2xl', isConsecutiveFromPrev && 'rounded-tl-sm', isConsecutiveToNext && 'rounded-bl-sm'),
                                                !isOwn && 'border border-border/60'
                                            ),
                                            'transition-[box-shadow,ring-color] duration-300 ease-out',
                                            isFocusedReplyTarget && (isOwn ? 'ring-2 ring-white/45 shadow-[0_16px_40px_-22px_rgba(59,130,246,0.9)]' : 'ring-2 ring-primary/45 shadow-[0_16px_40px_-22px_rgba(59,130,246,0.55)]')
                                        )}
                                        style={{ boxShadow: isFocusedReplyTarget ? undefined : 'var(--msg-shadow)', ...(isFocusedReplyTarget ? { animation: 'message-focus-pulse 1250ms cubic-bezier(0.22,1,0.36,1)' } : {}) }}
                                    >
                                        <div className="rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
                                            <textarea
                                                value={draftContent}
                                                onChange={(event) => setDraftContent(event.target.value)}
                                                rows={3}
                                                maxLength={4000}
                                                className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-ring dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                            />
                                            <div className="mt-2 flex items-center justify-end gap-2">
                                                <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-600 dark:text-zinc-300" onClick={() => { setDraftContent(message.content || ''); setIsEditing(false); }} disabled={isActionLoading}>Cancel</button>
                                                <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-60" onClick={() => void handleSaveEdit()} disabled={isActionLoading}>{isActionLoading ? 'Saving...' : 'Save'}</button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {(parsedSegments.length === 0 ? [{ type: 'empty', content: '' }] : parsedSegments).map((segment, index, arr) => {
                                            const isFirst = index === 0;
                                            const isLast = index === arr.length - 1;
                                            
                                            const renderPrefix = () => (
                                                <>
                                                    {isFocusedReplyTarget ? (
                                                        <>
                                                            <div className={cn('absolute inset-y-3 w-1 rounded-full', isOwn ? '-right-2 bg-white/70' : '-left-2 bg-primary/70')} />
                                                            <div className="mb-2 flex items-center gap-2">
                                                                <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', isOwn ? 'border-white/20 bg-white/10 text-white/90' : 'border-primary/20 bg-primary/5 text-primary')}>
                                                                    {getReplyFocusLabel(focusSource || 'external')}
                                                                </span>
                                                            </div>
                                                        </>
                                                    ) : null}
                                                    {message.replyTo ? (
                                                        <button type="button" onClick={() => onFocusMessage?.(message.replyTo!.id, 'reply')} className={cn('mb-2 w-full rounded-xl border px-2.5 py-2 text-left text-xs transition-colors duration-200', isOwn ? 'border-white/15 bg-white/10 text-primary-foreground/90 hover:bg-white/14' : 'border-zinc-200 bg-zinc-50/90 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-800')} title={replyPreviewText || 'Open original message'} aria-label="Jump to original replied message">
                                                            <div className="flex items-start gap-2">
                                                                <div className={cn('mt-0.5 w-1 self-stretch rounded-full', isOwn ? 'bg-white/55' : 'bg-primary/55')} />
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="truncate font-semibold">{message.replyTo.senderName || 'Reply'}</div>
                                                                        {replyPreviewBadge ? <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', isOwn ? 'bg-white/10 text-white/80' : 'bg-primary/10 text-primary')}>{replyPreviewBadge}</span> : null}
                                                                    </div>
                                                                    <div className="mt-0.5 line-clamp-2 break-words opacity-90">{replyPreviewText}</div>
                                                                </div>
                                                            </div>
                                                        </button>
                                                    ) : null}
                                                    {(isPinned || isApplication || privateFollowUp) ? (
                                                        <div className="mb-1 flex items-center gap-2">
                                                            {isPinned ? <span className={\`text-[10px] font-bold uppercase \${isOwn ? 'text-white/80' : 'text-amber-600 dark:text-amber-400'}\`}>Pinned</span> : null}
                                                            {privateFollowUp ? <span className={\`text-[10px] font-bold uppercase \${isOwn ? 'text-white/80' : 'text-emerald-600 dark:text-emerald-400'}\`}>Follow up{privateFollowUp.dueAt ? \` · \${format(new Date(privateFollowUp.dueAt), 'MMM d')}\` : ''}</span> : null}
                                                        </div>
                                                    ) : null}
                                                </>
                                            );
                                            
                                            const renderSuffix = () => (
                                                <>
                                                    {structured ? (
                                                        <StructuredMessageCardV2 structured={structured} isOwn={isOwn} currentUserId={user?.id ?? null} creatorId={message.senderId ?? null} isActionLoading={workflowActionLoading} onResolveAction={structured.workflowItemId ? handleResolveWorkflow : undefined} />
                                                    ) : null}
                                                    {!structured && contextChips.length > 0 ? (
                                                        <MessageContextChipRowV2 chips={contextChips} tone={isOwn ? 'inverted' : 'default'} compact />
                                                    ) : null}
                                                    {linkedWork.length > 0 ? (
                                                        <div className="mb-2 flex min-w-0 max-w-full flex-wrap items-center gap-1.5 overflow-hidden">
                                                            {visibleLinkedWork.map((link) => {
                                                                const label = getLinkedWorkDisplayLabel(link);
                                                                return (
                                                                    <button key={link.id} type="button" disabled={!link.href || link.status === 'unavailable'} onClick={() => { if (!link.href || link.status === 'unavailable') { toast.info('Linked destination is unavailable'); return; } router.push(link.href); }} className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors sm:max-w-[220px]', isOwn ? 'border-white/15 bg-white/10 text-white/90 hover:bg-white/15 disabled:text-white/45' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/65 dark:disabled:border-zinc-800 dark:disabled:bg-zinc-900')} title={link.subtitle ?? label}>
                                                                        {link.isPrivate ? <Lock className="h-3 w-3 shrink-0" /> : <BriefcaseBusiness className="h-3 w-3 shrink-0" />}
                                                                        <span className="shrink-0 opacity-75">{link.badge}</span>
                                                                        <span className="truncate">{label}</span>
                                                                        {link.status !== 'active' && link.status !== 'pending' ? <span className="shrink-0 rounded-full bg-current/10 px-1 uppercase opacity-80">{link.status}</span> : null}
                                                                        {link.href ? <ExternalLink className="h-3 w-3 shrink-0 opacity-60" /> : null}
                                                                    </button>
                                                                );
                                                            })}
                                                            {linkedWork.length > 2 ? (
                                                                <button type="button" onClick={() => setLinkedWorkExpanded((current) => !current)} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold', isOwn ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700')}>
                                                                    {linkedWorkExpanded ? 'Show less' : \`\${linkedWork.length - 2} linked items\`}
                                                                    <ChevronDown className={cn('h-3 w-3 transition-transform', linkedWorkExpanded && 'rotate-180')} />
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                    {renderedLinkPreview && !isApplication ? (
                                                        <LinkPreviewCard preview={renderedLinkPreview} isOwn={isOwn} loading={!linkPreview} onContentLoad={onContentLoad} />
                                                    ) : null}
                                                </>
                                            );
                                            
                                            if (segment.type === 'code') {
                                                return (
                                                    <React.Fragment key={index}>
                                                        {isFirst && (isFocusedReplyTarget || message.replyTo || isPinned || privateFollowUp || isApplication) && (
                                                            <div className="msg-bubble-shell !bg-transparent !border-0 !shadow-none !p-0">
                                                                {renderPrefix()}
                                                            </div>
                                                        )}
                                                        <CodeSegmentV2 code={segment.content} language={segment.language as string | null} isOwn={isOwn} />
                                                        {isLast && (structured || contextChips.length > 0 || linkedWork.length > 0 || renderedLinkPreview) && (
                                                            <div className="msg-bubble-shell !bg-transparent !border-0 !shadow-none !p-0">
                                                                {renderSuffix()}
                                                            </div>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            }
                                            
                                            // Text or empty segment
                                            return (
                                                <div
                                                    key={index}
                                                    className={cn(
                                                        'msg-bubble-shell',
                                                        isOwn ? 'msg-bubble-own' : 'msg-bubble-peer',
                                                        (onlyEmojis || isApplication || (segment.type === 'empty' && parsedSegments.length === 0 && isCodeOnlyContent)) ? '!bg-transparent !bg-none !border-0 !shadow-none !p-0' : cn(
                                                            isOwn ? cn('rounded-2xl', isConsecutiveFromPrev && isFirst && 'rounded-tr-sm', isConsecutiveToNext && isLast && 'rounded-br-sm') : cn('rounded-2xl', isConsecutiveFromPrev && isFirst && 'rounded-tl-sm', isConsecutiveToNext && isLast && 'rounded-bl-sm'),
                                                            !isOwn && 'border border-border/60'
                                                        ),
                                                        'transition-[box-shadow,ring-color] duration-300 ease-out',
                                                        isFocusedReplyTarget && isFirst && (isOwn ? 'ring-2 ring-white/45 shadow-[0_16px_40px_-22px_rgba(59,130,246,0.9)]' : 'ring-2 ring-primary/45 shadow-[0_16px_40px_-22px_rgba(59,130,246,0.55)]')
                                                    )}
                                                    style={{ boxShadow: (isFocusedReplyTarget && isFirst) ? undefined : 'var(--msg-shadow)', ...((isFocusedReplyTarget && isFirst) ? { animation: 'message-focus-pulse 1250ms cubic-bezier(0.22,1,0.36,1)' } : {}) }}
                                                >
                                                    {isFirst && renderPrefix()}
                                                    
                                                    {segment.content ? (
                                                        isApplication ? (
                                                            <ApplicationSystemCardV2 message={message} conversationId={message.conversationId} />
                                                        ) : (
                                                            <div className="min-w-0 max-w-full space-y-2">
                                                                <p className={onlyEmojis ? "text-[44px] leading-tight" : "msg-message-text leading-relaxed whitespace-pre-wrap break-words"}>
                                                                    {renderTextWithMentions(segment.content, isOwn)}
                                                                </p>
                                                            </div>
                                                        )
                                                    ) : null}
                                                    
                                                    {isLast && renderSuffix()}
                                                </div>
                                            );
                                        })
                                    )}
                                </>
                            )
                        ) : null}

                        </motion.div>`;

fullCode = fullCode.substring(0, startIndex) + replacement + fullCode.substring(endIndex + endStr.length);

fs.writeFileSync('/Users/chrama/Downloads/nb-s3/src/components/chat/v2/MessageBubbleV2.tsx', fullCode);
console.log('Successfully replaced MessageBubbleV2.tsx content with exact boundaries.');
