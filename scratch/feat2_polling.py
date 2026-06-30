import re

with open("src/components/people/RequestsTab.tsx", "r") as f:
    content = f.read()

# Add to imports
if "useQuery" not in content:
    content = content.replace('import { useInfiniteQuery, useMutation, useQueryClient }', 'import { useInfiniteQuery, useMutation, useQueryClient, useQuery }')
else:
    # useQuery is already imported, we assume. But wait, useQuery might be in the same import block.
    # Actually useInfiniteQuery is not imported in RequestsTab, it's imported in useConnections.
    pass

# We need to import useQuery from @tanstack/react-query
if "import { useQuery } from '@tanstack/react-query'" not in content:
    content = content.replace("import React, {", "import { useQuery } from '@tanstack/react-query';\nimport React, {")

# Find startBulkJobPolling
start_func_pattern = r'const startBulkJobPolling = useCallback\(\(jobId: string, count: number, action: "accept" \| "reject"\) => \{.*?\}, \[\]\);'

polling_replacement = """    const [pollingJob, setPollingJob] = useState<{ id: string, count: number, action: "accept" | "reject" | "withdraw" } | null>(null);

    const { data: jobStatus } = useQuery({
        queryKey: ['bulk-job', pollingJob?.id],
        queryFn: async () => {
            const res = await fetch(`/api/jobs/connection-bulk?jobId=${pollingJob?.id}`);
            if (!res.ok) throw new Error("Failed");
            return res.json();
        },
        enabled: !!pollingJob?.id,
        refetchInterval: (query) => (query.state.data?.status === 'completed' || query.state.data?.status === 'failed' ? false : 3000),
    });

    useEffect(() => {
        if (!pollingJob) return;
        if (jobStatus?.status === 'completed') {
            toast.success(`All ${pollingJob.count} requests ${pollingJob.action}ed successfully.`);
            setPollingJob(null);
        } else if (jobStatus?.status === 'failed') {
            toast.error(`Bulk ${pollingJob.action} failed. Some requests may not have been processed.`);
            setPollingJob(null);
        }
    }, [jobStatus, pollingJob]);

    const startBulkJobPolling = useCallback((jobId: string, count: number, action: "accept" | "reject" | "withdraw") => {
        setPollingJob({ id: jobId, count, action });
        toast.loading(`Bulk ${action} processing...`, { id: 'bulk-job-toast' });
    }, []);"""

content = re.sub(start_func_pattern, polling_replacement, content, flags=re.DOTALL)

# Handle toast dismissal in useEffect
content = content.replace('toast.success(`All ${pollingJob.count} requests', 'toast.dismiss("bulk-job-toast");\n            toast.success(`All ${pollingJob.count} requests')
content = content.replace('toast.error(`Bulk ${pollingJob.action} failed', 'toast.dismiss("bulk-job-toast");\n            toast.error(`Bulk ${pollingJob.action} failed')

with open("src/components/people/RequestsTab.tsx", "w") as f:
    f.write(content)
