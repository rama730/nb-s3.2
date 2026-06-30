import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

if "import { toast }" not in content:
    content = content.replace("import { useEffect, useRef, useCallback, useMemo } from 'react';", "import { useEffect, useRef, useCallback, useMemo } from 'react';\nimport { toast } from 'sonner';")

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)
