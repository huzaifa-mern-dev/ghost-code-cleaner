const { ShopifyAdminClient } = require("./packages/shopify/dist/index.js");

(async () => {
  const client = new ShopifyAdminClient("ghost-code-test.myshopify.com", "shpua_f49fe9224089dd64d03c915aee85d0f1");
  const res = await client.request("POST", "/graphql.json", {
    query: `
      mutation themeDuplicate($id: ID!, $name: String!) {
        themeDuplicate(id: $id, name: $name) {
          theme {
            id
            name
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    variables: {
      id: "gid://shopify/Theme/188304032116",
      name: "GraphQL Duplicated Theme"
    }
  });
  console.log(JSON.stringify(res, null, 2));
})();
