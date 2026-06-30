import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# Add tagFilter to ConnectionsFeedInput
input_interface = """export interface ConnectionsFeedInput {
    limit?: number;
    cursor?: string;
    search?: string;
    sortBy?: 'recent' | 'name' | 'oldest';
}"""
input_interface_new = """export interface ConnectionsFeedInput {
    limit?: number;
    cursor?: string;
    search?: string;
    sortBy?: 'recent' | 'name' | 'oldest';
    tagFilter?: string;
}"""
content = content.replace(input_interface, input_interface_new)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)
