import re

with open("src/app/(main)/people/page.tsx", "r") as f:
    content = f.read()

content = content.replace(
    "initialUser={user}",
    "initialUser={user ? { id: user.id } : null}"
)

with open("src/app/(main)/people/page.tsx", "w") as f:
    f.write(content)

