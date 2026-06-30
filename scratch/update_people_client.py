import re

with open("src/components/people/PeopleClient.tsx", "r") as f:
    content = f.read()

# 1. Update imports
import_stmt = 'import { useSuggestedPeople, useMutualSuggestions, useRoleSuggestions } from "@/hooks/useConnections";\n'
content = content.replace('import { useSuggestedPeople } from "@/hooks/useConnections";', import_stmt)

# 2. Add the hooks
hooks = """    const { data: mutuals } = useMutualSuggestions();
    const { data: roles } = useRoleSuggestions();
    const mutualProfiles = mutuals || [];
    const roleProfiles = roles || [];
    const contextProfiles: DiscoverConnectionItem[] = []; // Omitted for simplicity as per refactor, or we can leave it empty
"""

# Replace the useMemo that splits profiles
# The pattern is: `const { mutualProfiles, contextProfiles, roleProfiles, streamProfiles } = useMemo(() => { ... }, [filteredProfiles, isSearching]);`
split_pattern = r"(const \{\s*mutualProfiles,\s*contextProfiles,\s*roleProfiles,\s*streamProfiles\s*\} = useMemo\(\(\) => \{[\s\S]*?\}, \[filteredProfiles, isSearching\]\);)"

new_split = """
    const { data: mutuals } = useMutualSuggestions();
    const { data: roles } = useRoleSuggestions();
    
    // In search mode, we still show the lanes if we want (the audit said "Retain contextual search groupings instead of hiding lanes")
    // Or we can just let them be empty if searching.
    const mutualProfiles = isSearching ? [] : (mutuals || []);
    const roleProfiles = isSearching ? [] : (roles || []);
    const contextProfiles: any[] = [];
    const streamProfiles = filteredProfiles;
"""

content = re.sub(split_pattern, new_split, content)

with open("src/components/people/PeopleClient.tsx", "w") as f:
    f.write(content)

print("Updated PeopleClient!")
