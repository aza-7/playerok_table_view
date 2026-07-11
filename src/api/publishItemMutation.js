import { CREATE_ITEM_MUTATION } from './createItemMutation.js';

export const PUBLISH_ITEM_MUTATION =
  'mutation publishItem($input: PublishItemInput!, $showForbiddenImage: Boolean) {\n  publishItem(input: $input) {\n    ...RegularItem\n  \n  __typename\n}\n}' +
  CREATE_ITEM_MUTATION.slice(CREATE_ITEM_MUTATION.indexOf('\n\nfragment'));
