import re

with open('.env', 'r') as f:
    lines = f.readlines()

new_lines = []
found_postgres = False

for line in lines:
    # Identify the postgres URL line by its unique domain
    if 'render.com/pagepay_db' in line:
        # Remove comment and whitespace
        url = line.strip().lstrip('#').strip()
        # Ensure it starts with DATABASE_URL=
        if not url.startswith('DATABASE_URL='):
            url = 'DATABASE_URL=' + url
        # Ensure it's asyncpg
        url = url.replace('postgresql://', 'postgresql+asyncpg://')

        # We'll add this at the top instead of here
        found_postgres = True
        continue

    # Comment out any existing DATABASE_URL=mysql lines
    if line.startswith('DATABASE_URL=mysql+aiomysql'):
        new_lines.append('# ' + line)
    else:
        new_lines.append(line)

# If we found a postgres URL, put it at the very top
if found_postgres:
    # We need to recover the actual URL from the original file since we didn't store it as a variable
    # but we can just find the line again in the original content
    with open('.env', 'r') as f:
        for line in f:
            if 'render.com/pagepay_db' in line:
                url = line.strip().lstrip('#').strip()
                if not url.startswith('DATABASE_URL='):
                    url = 'DATABASE_URL=' + url
                url = url.replace('postgresql://', 'postgresql+asyncpg://')
                new_lines.insert(0, url + '\n')
                break

with open('.env', 'w') as f:
    f.writelines(new_lines)
