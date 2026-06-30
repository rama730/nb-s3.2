import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

bad_block = """            });

    const withdrawAllSent = useMutation({
        mutationFn: async () => {
            const res = await withdrawAllSentConnectionRequests();
            if (!res.success) throw new Error(res.error || 'Failed to withdraw requests');
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
            queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
            queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
            toast.success("Withdrawn all sent requests");
        }
    });


            if (acceptedCount > 0) {"""

good_block = """            });

            if (acceptedCount > 0) {"""

withdraw_mutation = """
    const withdrawAllSent = useMutation({
        mutationFn: async () => {
            const res = await withdrawAllSentConnectionRequests();
            if (!res.success) throw new Error(res.error || 'Failed to withdraw requests');
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
            queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
            queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
            toast.success("Withdrawn all sent requests");
        }
    });
"""

# Remove from bad location
content = content.replace(bad_block, good_block)

# Add it after acceptAllIncoming
target_anchor = "        onSettled: invalidateAll,\n    });\n\n    const rejectAllIncoming"
new_target = "        onSettled: invalidateAll,\n    });" + withdraw_mutation + "\n    const rejectAllIncoming"

content = content.replace(target_anchor, new_target)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

