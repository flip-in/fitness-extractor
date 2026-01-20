# Create Worktree

Create a new git worktree for parallel development.

## Usage

Run the create-worktree script:

```bash
./scripts/create-worktree.sh $ARGUMENTS
```

Arguments:
- First arg: worktree name (optional, auto-generates if omitted)
- Second arg: base branch (optional, defaults to current branch)

## Examples

```bash
# Auto-generate name from current branch
./scripts/create-worktree.sh

# Named worktree from current branch
./scripts/create-worktree.sh my-feature

# Named worktree from specific base
./scripts/create-worktree.sh my-feature main
```

The script will:
1. Create worktree at `../fitness-extractor-{name}/`
2. Create branch with same name
3. Copy `.env` from main repo
4. Install dependencies with pnpm
5. Print cleanup instructions
