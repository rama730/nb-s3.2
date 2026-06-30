import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# Add import for withdrawAllSentConnectionRequests
content = content.replace("cancelConnectionRequest,", "cancelConnectionRequest,\n    withdrawAllSentConnectionRequests,")

mutation = """
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

# Insert mutation inside useConnectionMutations
pattern = r"(const acceptAllIncoming = useMutation\(\{.*?\n\s*\}\);)"
content = re.sub(pattern, r"\1\n" + mutation, content, flags=re.DOTALL)

# Add to return statement
return_pattern = r"(return \{[\s\S]*?)(\n\s*\};)"
content = re.sub(return_pattern, r"\1,\n        withdrawAllSent\2", content)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

print("Added withdrawAllSent mutation!")
