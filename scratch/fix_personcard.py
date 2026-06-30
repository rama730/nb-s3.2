with open("src/components/people/PersonCard.tsx", "r") as f:
    content = f.read()

content = content.replace(
    """<DropdownMenuContent align="end" className="w-52">
                            <RelationshipMenuItems
                                actions={actionModel.secondaryMenu}
                                onDisconnect={handleDisconnect}
                                onBlock={handleBlock}
                                isProcessing={isDisconnecting || isBlocking}
                            />
                        </DropdownMenuContent>""",
    """<DropdownMenuContent align="end" className="w-52">
                            <RelationshipMenuItems
                                actions={actionModel.connectedMenu}
                                onDisconnect={handleDisconnect}
                                onBlock={handleBlock}
                                isProcessing={isDisconnecting || isBlocking}
                            />
                        </DropdownMenuContent>"""
)

old_secondary = """                        <DropdownMenuContent align="end" className="w-52">
                            <RelationshipMenuItems
                                actions={actionModel.secondaryMenu}
                                onDisconnect={handleDisconnect}
                                isProcessing={isDisconnecting}
                            />
                        </DropdownMenuContent>"""
new_secondary = """                        <DropdownMenuContent align="end" className="w-52">
                            <RelationshipMenuItems
                                actions={actionModel.secondaryMenu}
                                onDisconnect={handleDisconnect}
                                onBlock={handleBlock}
                                isProcessing={isDisconnecting || isBlocking}
                            />
                        </DropdownMenuContent>"""

content = content.replace(old_secondary, new_secondary)

with open("src/components/people/PersonCard.tsx", "w") as f:
    f.write(content)

