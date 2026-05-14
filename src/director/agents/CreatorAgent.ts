export class CreatorAgent {
  async proposeGraphEdits(goal: string) {
    return [{ op: 'add', node: { type: 'proposed_node', meta: { goal } } }];
  }
}
