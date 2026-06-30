import re

with open("src/components/people/PeopleHubClient.tsx", "r") as f:
    content = f.read()

old_state = """    const [activeTab, setActiveTab] = useState<TabKey>(getInitialTab);
useEffect(() => {
        if (VALID_TABS.includes(tabParam as TabKey)) {
            setActiveTab(tabParam as TabKey);
        } else if (activeTabOverride && VALID_TABS.includes(activeTabOverride)) {
            setActiveTab(activeTabOverride);
        }
    }, [tabParam, activeTabOverride]);"""

new_state = """    const activeTab = getInitialTab();"""

content = content.replace(old_state, new_state)

# Need to check if setActiveTab is used anywhere else
content = content.replace("setActiveTab(", "// setActiveTab(")

with open("src/components/people/PeopleHubClient.tsx", "w") as f:
    f.write(content)

