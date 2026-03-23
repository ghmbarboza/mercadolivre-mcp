#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const axios = require("axios");

const BASE_URL = "https://api.mercadolibre.com";
const AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

// HTTP client com token dinâmico
function api(accessToken) {
  return axios.create({
    baseURL: BASE_URL,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

async function call(fn) {
  try {
    const res = await fn();
    return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    return { content: [{ type: "text", text: `Erro: ${msg}` }], isError: true };
  }
}

const server = new McpServer({ name: "mercadolivre", version: "1.0.0" });

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

server.tool(
  "ml_get_auth_url",
  "Gera a URL de autorização OAuth2 do Mercado Livre",
  {
    client_id: z.string().describe("App ID da sua aplicação"),
    redirect_uri: z.string().describe("URI de redirecionamento cadastrada"),
    state: z.string().optional().describe("Valor aleatório para segurança"),
  },
  async ({ client_id, redirect_uri, state }) => {
    const params = new URLSearchParams({ response_type: "code", client_id, redirect_uri });
    if (state) params.set("state", state);
    return { content: [{ type: "text", text: `${AUTH_URL}?${params}` }] };
  }
);

server.tool(
  "ml_exchange_code",
  "Troca o código de autorização por access_token e refresh_token",
  {
    client_id: z.string(),
    client_secret: z.string(),
    code: z.string().describe("Código retornado pelo redirect"),
    redirect_uri: z.string(),
  },
  async ({ client_id, client_secret, code, redirect_uri }) => {
    return call(() =>
      axios.post(TOKEN_URL, null, {
        params: { grant_type: "authorization_code", client_id, client_secret, code, redirect_uri },
      })
    );
  }
);

server.tool(
  "ml_refresh_token",
  "Renova o access_token usando o refresh_token",
  {
    client_id: z.string(),
    client_secret: z.string(),
    refresh_token: z.string(),
  },
  async ({ client_id, client_secret, refresh_token }) => {
    return call(() =>
      axios.post(TOKEN_URL, null, {
        params: { grant_type: "refresh_token", client_id, client_secret, refresh_token },
      })
    );
  }
);

// ─────────────────────────────────────────────
// USUÁRIO
// ─────────────────────────────────────────────

server.tool(
  "ml_get_me",
  "Retorna os dados do usuário autenticado",
  { access_token: z.string() },
  async ({ access_token }) => call(() => api(access_token).get("/users/me"))
);

server.tool(
  "ml_get_user",
  "Retorna dados de um usuário pelo ID",
  {
    access_token: z.string(),
    user_id: z.string().describe("ID do usuário"),
  },
  async ({ access_token, user_id }) =>
    call(() => api(access_token).get(`/users/${user_id}`))
);

server.tool(
  "ml_get_users",
  "Retorna dados de múltiplos usuários (até 20)",
  {
    access_token: z.string(),
    ids: z.string().describe("IDs separados por vírgula"),
  },
  async ({ access_token, ids }) =>
    call(() => api(access_token).get("/users", { params: { ids } }))
);

// ─────────────────────────────────────────────
// ITENS
// ─────────────────────────────────────────────

server.tool(
  "ml_get_item",
  "Retorna os detalhes de um item pelo ID",
  {
    access_token: z.string(),
    item_id: z.string().describe("Ex: MLB123456789"),
  },
  async ({ access_token, item_id }) =>
    call(() => api(access_token).get(`/items/${item_id}`))
);

server.tool(
  "ml_get_items",
  "Retorna múltiplos itens de uma vez (até 20)",
  {
    access_token: z.string(),
    ids: z.string().describe("IDs separados por vírgula"),
    attributes: z.string().optional().describe("Campos a retornar, ex: id,title,price"),
  },
  async ({ access_token, ids, attributes }) =>
    call(() => api(access_token).get("/items", { params: { ids, attributes } }))
);

server.tool(
  "ml_create_item",
  "Cria um novo anúncio no Mercado Livre",
  {
    access_token: z.string(),
    title: z.string().describe("Título do produto"),
    category_id: z.string().describe("ID da categoria, ex: MLB1055"),
    price: z.number().describe("Preço do produto"),
    currency_id: z.string().default("BRL").describe("Moeda, padrão BRL"),
    available_quantity: z.number().describe("Quantidade disponível"),
    buying_mode: z.enum(["buy_it_now", "auction"]).default("buy_it_now"),
    condition: z.enum(["new", "used"]).default("new"),
    listing_type_id: z.string().default("gold_special").describe("Tipo de listagem"),
    description: z.string().optional().describe("Descrição do produto"),
    pictures: z
      .array(z.object({ source: z.string().url() }))
      .optional()
      .describe("URLs das imagens"),
    attributes: z
      .array(z.object({ id: z.string(), value_name: z.string() }))
      .optional()
      .describe("Atributos do produto"),
  },
  async ({ access_token, description, ...body }) => {
    if (description) body.description = { plain_text: description };
    return call(() => api(access_token).post("/items", body));
  }
);

server.tool(
  "ml_update_item",
  "Atualiza campos de um anúncio existente",
  {
    access_token: z.string(),
    item_id: z.string(),
    title: z.string().optional(),
    price: z.number().optional(),
    available_quantity: z.number().optional(),
    status: z.enum(["active", "paused", "closed"]).optional(),
  },
  async ({ access_token, item_id, ...body }) =>
    call(() => api(access_token).put(`/items/${item_id}`, body))
);

server.tool(
  "ml_delete_item",
  "Fecha/remove um anúncio (status=closed)",
  {
    access_token: z.string(),
    item_id: z.string(),
  },
  async ({ access_token, item_id }) =>
    call(() => api(access_token).put(`/items/${item_id}`, { status: "closed" }))
);

server.tool(
  "ml_get_item_description",
  "Retorna a descrição de um item",
  {
    access_token: z.string(),
    item_id: z.string(),
  },
  async ({ access_token, item_id }) =>
    call(() => api(access_token).get(`/items/${item_id}/description`))
);

server.tool(
  "ml_update_item_description",
  "Atualiza a descrição de um item",
  {
    access_token: z.string(),
    item_id: z.string(),
    plain_text: z.string().describe("Novo texto da descrição"),
  },
  async ({ access_token, item_id, plain_text }) =>
    call(() =>
      api(access_token).put(`/items/${item_id}/description`, { plain_text })
    )
);

// ─────────────────────────────────────────────
// BUSCA
// ─────────────────────────────────────────────

server.tool(
  "ml_search_items",
  "Busca anúncios por vendedor, categoria ou query",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB").describe("Site: MLB=Brasil, MLA=Argentina..."),
    seller_id: z.string().optional(),
    nickname: z.string().optional(),
    category: z.string().optional(),
    q: z.string().optional().describe("Texto de busca"),
    sort: z.string().optional().describe("Ex: price_asc, price_desc"),
    offset: z.number().optional().default(0),
    limit: z.number().optional().default(50),
  },
  async ({ access_token, site_id, ...params }) =>
    call(() =>
      api(access_token).get(`/sites/${site_id}/search`, { params })
    )
);

server.tool(
  "ml_search_seller_items",
  "Lista todos os itens de um vendedor com filtros avançados",
  {
    access_token: z.string(),
    user_id: z.string(),
    status: z.enum(["active", "paused", "closed", "under_review"]).optional(),
    sku: z.string().optional(),
    search_type: z.enum(["scan"]).optional().describe("Use 'scan' para mais de 1000 itens"),
    scroll_id: z.string().optional().describe("Para paginação com search_type=scan"),
    reputation_health_gauge: z
      .enum(["unhealthy", "warning", "healthy"])
      .optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ access_token, user_id, ...params }) =>
    call(() =>
      api(access_token).get(`/users/${user_id}/items/search`, { params })
    )
);

server.tool(
  "ml_predict_category",
  "Sugere categorias e atributos a partir do título do produto",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    q: z.string().describe("Título do produto"),
    limit: z.number().optional().default(4),
  },
  async ({ access_token, site_id, q, limit }) =>
    call(() =>
      api(access_token).get(`/sites/${site_id}/domain_discovery/search`, {
        params: { q, limit },
      })
    )
);

// ─────────────────────────────────────────────
// CATEGORIAS
// ─────────────────────────────────────────────

server.tool(
  "ml_get_categories",
  "Retorna todas as categorias raiz de um site",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
  },
  async ({ access_token, site_id }) =>
    call(() => api(access_token).get(`/sites/${site_id}/categories`))
);

server.tool(
  "ml_get_category",
  "Retorna detalhes de uma categoria",
  {
    access_token: z.string(),
    category_id: z.string().describe("Ex: MLB1055"),
  },
  async ({ access_token, category_id }) =>
    call(() => api(access_token).get(`/categories/${category_id}`))
);

server.tool(
  "ml_get_category_attributes",
  "Retorna os atributos de uma categoria",
  {
    access_token: z.string(),
    category_id: z.string(),
  },
  async ({ access_token, category_id }) =>
    call(() => api(access_token).get(`/categories/${category_id}/attributes`))
);

// ─────────────────────────────────────────────
// PEDIDOS / ORDERS
// ─────────────────────────────────────────────

server.tool(
  "ml_get_order",
  "Retorna os detalhes completos de um pedido",
  {
    access_token: z.string(),
    order_id: z.string(),
  },
  async ({ access_token, order_id }) =>
    call(() => api(access_token).get(`/orders/${order_id}`))
);

server.tool(
  "ml_search_orders",
  "Busca pedidos por vendedor com filtros de status e data",
  {
    access_token: z.string(),
    seller: z.string().describe("User ID do vendedor"),
    status: z
      .enum(["confirmed", "payment_required", "payment_in_process", "partially_paid", "paid", "cancelled"])
      .optional(),
    date_created_from: z.string().optional().describe("ISO8601, ex: 2024-01-01T00:00:00.000-03:00"),
    date_created_to: z.string().optional(),
    sort: z.string().optional().describe("Ex: date_desc"),
    offset: z.number().optional().default(0),
    limit: z.number().optional().default(50),
  },
  async ({ access_token, seller, status, date_created_from, date_created_to, sort, offset, limit }) => {
    const params = { seller, sort, offset, limit };
    if (status) params["order.status"] = status;
    if (date_created_from) params["order.date_created.from"] = date_created_from;
    if (date_created_to) params["order.date_created.to"] = date_created_to;
    return call(() => api(access_token).get("/orders/search", { params }));
  }
);

server.tool(
  "ml_get_order_product",
  "Retorna informações do produto dentro de um pedido",
  {
    access_token: z.string(),
    order_id: z.string(),
  },
  async ({ access_token, order_id }) =>
    call(() => api(access_token).get(`/orders/${order_id}/product`))
);

// ─────────────────────────────────────────────
// PERGUNTAS
// ─────────────────────────────────────────────

server.tool(
  "ml_get_question",
  "Retorna uma pergunta pelo ID",
  {
    access_token: z.string(),
    question_id: z.string(),
  },
  async ({ access_token, question_id }) =>
    call(() => api(access_token).get(`/questions/${question_id}`))
);

server.tool(
  "ml_search_questions",
  "Busca perguntas de um item ou vendedor",
  {
    access_token: z.string(),
    item_id: z.string().optional(),
    seller_id: z.string().optional(),
    status: z.enum(["unanswered", "answered", "closed", "under_review", "banned", "deleted"]).optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ access_token, ...params }) =>
    call(() => api(access_token).get("/questions/search", { params }))
);

server.tool(
  "ml_answer_question",
  "Responde uma pergunta de um comprador",
  {
    access_token: z.string(),
    question_id: z.string(),
    text: z.string().describe("Texto da resposta"),
  },
  async ({ access_token, question_id, text }) =>
    call(() =>
      api(access_token).post(`/answers`, { question_id, text })
    )
);

// ─────────────────────────────────────────────
// LOCALIZAÇÃO / MOEDAS
// ─────────────────────────────────────────────

server.tool(
  "ml_get_currencies",
  "Lista todas as moedas disponíveis na plataforma",
  { access_token: z.string() },
  async ({ access_token }) => call(() => api(access_token).get("/currencies"))
);

server.tool(
  "ml_get_currency_conversion",
  "Retorna a taxa de conversão entre duas moedas",
  {
    access_token: z.string(),
    from: z.string().describe("Ex: BRL"),
    to: z.string().describe("Ex: USD"),
  },
  async ({ access_token, from, to }) =>
    call(() =>
      api(access_token).get("/currency_conversions/search", { params: { from, to } })
    )
);

server.tool(
  "ml_get_countries",
  "Lista todos os países disponíveis",
  { access_token: z.string() },
  async ({ access_token }) =>
    call(() => api(access_token).get("/classified_locations/countries"))
);

server.tool(
  "ml_get_zip_code",
  "Retorna informações de um CEP",
  {
    access_token: z.string(),
    country_id: z.string().default("BR"),
    zip_code: z.string(),
  },
  async ({ access_token, country_id, zip_code }) =>
    call(() =>
      api(access_token).get(`/countries/${country_id}/zip_codes/${zip_code}`)
    )
);

// ─────────────────────────────────────────────
// ENVIOS
// ─────────────────────────────────────────────

server.tool(
  "ml_get_shipment",
  "Retorna os dados de envio de um pedido",
  {
    access_token: z.string(),
    shipment_id: z.string(),
  },
  async ({ access_token, shipment_id }) =>
    call(() => api(access_token).get(`/shipments/${shipment_id}`))
);

server.tool(
  "ml_get_shipment_label",
  "Retorna a etiqueta de envio",
  {
    access_token: z.string(),
    shipment_id: z.string(),
    response_type: z.enum(["pdf", "zpl"]).default("pdf"),
  },
  async ({ access_token, shipment_id, response_type }) =>
    call(() =>
      api(access_token).get(`/shipment_labels`, {
        params: { shipment_ids: shipment_id, response_type },
      })
    )
);

// ─────────────────────────────────────────────
// MENSAGENS
// ─────────────────────────────────────────────

server.tool(
  "ml_get_message",
  "Retorna os detalhes de uma mensagem pelo ID",
  {
    access_token: z.string(),
    message_id: z.string(),
  },
  async ({ access_token, message_id }) =>
    call(() => api(access_token).get(`/messages/${message_id}`))
);

server.tool(
  "ml_get_order_messages",
  "Lista mensagens de um pedido entre comprador e vendedor",
  {
    access_token: z.string(),
    order_id: z.string(),
    user_id: z.string().describe("ID do usuário autenticado"),
  },
  async ({ access_token, order_id, user_id }) =>
    call(() =>
      api(access_token).get(`/messages/packs/${order_id}/sellers/${user_id}`)
    )
);

server.tool(
  "ml_send_message",
  "Envia uma mensagem em um pedido",
  {
    access_token: z.string(),
    order_id: z.string(),
    user_id: z.string().describe("ID do usuário autenticado (vendedor)"),
    to: z.string().describe("ID do destinatário (comprador)"),
    text: z.string().describe("Texto da mensagem"),
  },
  async ({ access_token, order_id, user_id, to, text }) =>
    call(() =>
      api(access_token).post(
        `/messages/packs/${order_id}/sellers/${user_id}`,
        { from: { user_id }, to: { user_id: to }, text: { plain: text } }
      )
    )
);

// ─────────────────────────────────────────────
// FEEDBACK / AVALIAÇÕES
// ─────────────────────────────────────────────

server.tool(
  "ml_get_order_feedback",
  "Retorna as avaliações de um pedido",
  {
    access_token: z.string(),
    order_id: z.string(),
  },
  async ({ access_token, order_id }) =>
    call(() => api(access_token).get(`/orders/${order_id}/feedback`))
);

server.tool(
  "ml_create_feedback",
  "Cria uma avaliação para um pedido",
  {
    access_token: z.string(),
    order_id: z.string(),
    fulfilled: z.boolean().describe("true se o pedido foi cumprido"),
    rating: z.enum(["positive", "neutral", "negative"]),
    message: z.string().optional().describe("Comentário da avaliação"),
  },
  async ({ access_token, order_id, ...body }) =>
    call(() => api(access_token).post(`/orders/${order_id}/feedback`, body))
);

server.tool(
  "ml_reply_feedback",
  "Responde a uma avaliação recebida",
  {
    access_token: z.string(),
    feedback_id: z.string(),
    reply: z.string().describe("Texto da resposta"),
  },
  async ({ access_token, feedback_id, reply }) =>
    call(() =>
      api(access_token).post(`/feedback/${feedback_id}/reply`, { reply })
    )
);

server.tool(
  "ml_update_feedback",
  "Atualiza uma avaliação existente",
  {
    access_token: z.string(),
    feedback_id: z.string(),
    rating: z.enum(["positive", "neutral", "negative"]).optional(),
    message: z.string().optional(),
    fulfilled: z.boolean().optional(),
  },
  async ({ access_token, feedback_id, ...body }) =>
    call(() => api(access_token).put(`/feedback/${feedback_id}`, body))
);

// ─────────────────────────────────────────────
// ESTOQUE (USER PRODUCTS)
// ─────────────────────────────────────────────

server.tool(
  "ml_get_user_product_stock",
  "Retorna o estoque distribuído de um produto",
  {
    access_token: z.string(),
    user_product_id: z.string(),
  },
  async ({ access_token, user_product_id }) =>
    call(() =>
      api(access_token).get(`/user-products/${user_product_id}/stock`)
    )
);

server.tool(
  "ml_update_user_product_stock",
  "Atualiza o estoque de um produto (fulfillment)",
  {
    access_token: z.string(),
    user_product_id: z.string(),
    quantity: z.number().describe("Nova quantidade em estoque"),
    location_id: z.string().optional().describe("ID do centro de distribuição"),
  },
  async ({ access_token, user_product_id, quantity, location_id }) => {
    const body = { quantity };
    if (location_id) body.location_id = location_id;
    return call(() =>
      api(access_token).put(`/user-products/${user_product_id}/stock`, body)
    );
  }
);

server.tool(
  "ml_get_user_product",
  "Retorna os dados de um user-product",
  {
    access_token: z.string(),
    user_product_id: z.string(),
  },
  async ({ access_token, user_product_id }) =>
    call(() => api(access_token).get(`/user-products/${user_product_id}`))
);

// ─────────────────────────────────────────────
// CATÁLOGO
// ─────────────────────────────────────────────

server.tool(
  "ml_get_product",
  "Retorna os dados de um produto do catálogo",
  {
    access_token: z.string(),
    product_id: z.string().describe("Ex: MLB123456"),
  },
  async ({ access_token, product_id }) =>
    call(() => api(access_token).get(`/products/${product_id}`))
);

server.tool(
  "ml_get_item_catalog_eligibility",
  "Verifica se um item é elegível para o catálogo",
  {
    access_token: z.string(),
    item_id: z.string(),
  },
  async ({ access_token, item_id }) =>
    call(() =>
      api(access_token).get(`/items/${item_id}/catalog_listing_eligibility`)
    )
);

server.tool(
  "ml_get_items_catalog_eligibility",
  "Verifica elegibilidade de múltiplos itens para o catálogo",
  {
    access_token: z.string(),
    ids: z.string().describe("IDs separados por vírgula"),
  },
  async ({ access_token, ids }) =>
    call(() =>
      api(access_token).get(`/multiget/catalog_listing_eligibility`, {
        params: { ids },
      })
    )
);

server.tool(
  "ml_get_catalog_sale_terms",
  "Retorna os termos de venda disponíveis para uma categoria",
  {
    access_token: z.string(),
    category_id: z.string(),
  },
  async ({ access_token, category_id }) =>
    call(() =>
      api(access_token).get(`/categories/${category_id}/sale_terms`)
    )
);

// ─────────────────────────────────────────────
// PROMOÇÕES
// ─────────────────────────────────────────────

server.tool(
  "ml_get_seller_promotions",
  "Lista as promoções ativas de um vendedor",
  {
    access_token: z.string(),
    user_id: z.string(),
    status: z.enum(["active", "paused", "finished", "candidate"]).optional(),
  },
  async ({ access_token, user_id, status }) =>
    call(() =>
      api(access_token).get(`/seller-promotions/users/${user_id}`, {
        params: status ? { status } : {},
      })
    )
);

server.tool(
  "ml_get_promotion",
  "Retorna detalhes de uma promoção",
  {
    access_token: z.string(),
    promotion_id: z.string(),
  },
  async ({ access_token, promotion_id }) =>
    call(() =>
      api(access_token).get(`/seller-promotions/${promotion_id}`)
    )
);

server.tool(
  "ml_get_promotion_items",
  "Lista os itens de uma promoção",
  {
    access_token: z.string(),
    promotion_id: z.string(),
    user_id: z.string(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ access_token, promotion_id, user_id, limit, offset }) =>
    call(() =>
      api(access_token).get(
        `/seller-promotions/${promotion_id}/items`,
        { params: { user_id, limit, offset } }
      )
    )
);

server.tool(
  "ml_add_item_to_promotion",
  "Adiciona um item a uma promoção existente",
  {
    access_token: z.string(),
    promotion_id: z.string(),
    item_id: z.string(),
    price: z.number().describe("Preço promocional"),
  },
  async ({ access_token, promotion_id, item_id, price }) =>
    call(() =>
      api(access_token).post(`/seller-promotions/${promotion_id}/items`, {
        item_id,
        price,
      })
    )
);

server.tool(
  "ml_remove_item_from_promotion",
  "Remove um item de uma promoção",
  {
    access_token: z.string(),
    promotion_id: z.string(),
    item_id: z.string(),
  },
  async ({ access_token, promotion_id, item_id }) =>
    call(() =>
      api(access_token).delete(
        `/seller-promotions/${promotion_id}/items/${item_id}`
      )
    )
);

// ─────────────────────────────────────────────
// PREÇOS / COMPETITIVIDADE
// ─────────────────────────────────────────────

server.tool(
  "ml_get_price_to_win",
  "Retorna o status de buy box e preço para ganhar no catálogo",
  {
    access_token: z.string(),
    item_id: z.string(),
  },
  async ({ access_token, item_id }) =>
    call(() => api(access_token).get(`/items/${item_id}/price_to_win`))
);

server.tool(
  "ml_get_price_suggestion",
  "Retorna sugestões de preço para um item",
  {
    access_token: z.string(),
    item_id: z.string(),
  },
  async ({ access_token, item_id }) =>
    call(() =>
      api(access_token).get(`/suggestions/items/${item_id}/details`)
    )
);

server.tool(
  "ml_get_item_sale_price",
  "Retorna o preço de venda atual de um item com contexto",
  {
    access_token: z.string(),
    item_id: z.string(),
    context: z.string().optional().describe("Ex: channel=marketplace"),
  },
  async ({ access_token, item_id, context }) =>
    call(() =>
      api(access_token).get(`/items/${item_id}/sale_price`, {
        params: context ? { context } : {},
      })
    )
);

// ─────────────────────────────────────────────
// REPUTAÇÃO DO VENDEDOR
// ─────────────────────────────────────────────

server.tool(
  "ml_get_seller_reputation",
  "Retorna as métricas de reputação de um vendedor",
  {
    access_token: z.string(),
    user_id: z.string(),
  },
  async ({ access_token, user_id }) =>
    call(() =>
      api(access_token).get(`/users/${user_id}/seller_reputation`)
    )
);

server.tool(
  "ml_get_seller_reputation_levels",
  "Retorna os níveis de reputação disponíveis no site",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
  },
  async ({ access_token, site_id }) =>
    call(() =>
      api(access_token).get(`/sites/${site_id}/seller_reputation_levels`)
    )
);

// ─────────────────────────────────────────────
// APLICAÇÕES
// ─────────────────────────────────────────────

server.tool(
  "ml_get_application",
  "Retorna os detalhes de uma aplicação",
  {
    access_token: z.string(),
    app_id: z.string(),
  },
  async ({ access_token, app_id }) =>
    call(() => api(access_token).get(`/applications/${app_id}`))
);

server.tool(
  "ml_get_application_grants",
  "Lista todos os usuários que autorizaram a aplicação",
  {
    access_token: z.string(),
    app_id: z.string(),
  },
  async ({ access_token, app_id }) =>
    call(() => api(access_token).get(`/applications/${app_id}/grants`))
);

server.tool(
  "ml_get_user_applications",
  "Lista todas as aplicações autorizadas por um usuário",
  {
    access_token: z.string(),
    user_id: z.string(),
  },
  async ({ access_token, user_id }) =>
    call(() => api(access_token).get(`/users/${user_id}/applications`))
);

server.tool(
  "ml_revoke_application",
  "Revoga a autorização de uma aplicação para um usuário",
  {
    access_token: z.string(),
    user_id: z.string(),
    app_id: z.string(),
  },
  async ({ access_token, user_id, app_id }) =>
    call(() =>
      api(access_token).delete(`/users/${user_id}/applications/${app_id}`)
    )
);

server.tool(
  "ml_get_app_metrics",
  "Retorna métricas de consumo de API da aplicação",
  {
    access_token: z.string(),
    app_id: z.string(),
    date_start: z.string().optional().describe("ISO8601"),
    date_end: z.string().optional().describe("ISO8601"),
  },
  async ({ access_token, app_id, date_start, date_end }) =>
    call(() =>
      api(access_token).get(`/applications/v1/${app_id}/consumed-applications`, {
        params: { date_start, date_end },
      })
    )
);

// ─────────────────────────────────────────────
// NOTIFICAÇÕES
// ─────────────────────────────────────────────

server.tool(
  "ml_get_missed_feeds",
  "Retorna notificações perdidas (até 2 dias atrás)",
  {
    access_token: z.string(),
    app_id: z.string(),
    topic: z.string().optional().describe("Ex: orders_v2, items, questions"),
    offset: z.number().optional().default(0),
    limit: z.number().optional().default(100),
  },
  async ({ access_token, app_id, topic, offset, limit }) =>
    call(() =>
      api(access_token).get(`/missed_feeds`, {
        params: { app_id, topic, offset, limit },
      })
    )
);

// ─────────────────────────────────────────────
// VEÍCULOS
// ─────────────────────────────────────────────

server.tool(
  "ml_get_vehicle_body_types",
  "Retorna os tipos de carroceria disponíveis",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
  },
  async ({ access_token, site_id }) =>
    call(() => api(access_token).get(`/sites/${site_id}/vehicle_body_types`))
);

server.tool(
  "ml_search_vehicles",
  "Busca anúncios de veículos com filtros específicos",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    category: z.string().optional().describe("Ex: MLB1744 (Carros e Caminhonetes)"),
    make: z.string().optional().describe("Marca do veículo"),
    model: z.string().optional().describe("Modelo do veículo"),
    year_from: z.number().optional(),
    year_to: z.number().optional(),
    price_from: z.number().optional(),
    price_to: z.number().optional(),
    sort: z.string().optional(),
    offset: z.number().optional().default(0),
    limit: z.number().optional().default(50),
  },
  async ({ access_token, site_id, ...params }) =>
    call(() =>
      api(access_token).get(`/sites/${site_id}/search`, { params })
    )
);

server.tool(
  "ml_get_vehicle_packages",
  "Retorna os pacotes disponíveis para anúncios de veículos",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    category_id: z.string().describe("Categoria de veículos, ex: MLB1744"),
  },
  async ({ access_token, site_id, category_id }) =>
    call(() =>
      api(access_token).get(`/sites/${site_id}/listing_types`, {
        params: { category_id },
      })
    )
);

// ─────────────────────────────────────────────
// IMÓVEIS
// ─────────────────────────────────────────────

server.tool(
  "ml_search_real_estate",
  "Busca anúncios de imóveis com filtros específicos",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    category: z.string().optional().describe("Ex: MLB1459 (Imóveis)"),
    operation: z.enum(["sale", "rent"]).optional(),
    property_type: z.string().optional().describe("Ex: apartment, house"),
    state: z.string().optional(),
    city: z.string().optional(),
    price_from: z.number().optional(),
    price_to: z.number().optional(),
    sort: z.string().optional(),
    offset: z.number().optional().default(0),
    limit: z.number().optional().default(50),
  },
  async ({ access_token, site_id, ...params }) =>
    call(() =>
      api(access_token).get(`/sites/${site_id}/search`, { params })
    )
);

server.tool(
  "ml_get_real_estate_packages",
  "Retorna os pacotes disponíveis para anúncios de imóveis",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    category_id: z.string().describe("Categoria de imóveis, ex: MLB1459"),
  },
  async ({ access_token, site_id, category_id }) =>
    call(() =>
      api(access_token).get(`/sites/${site_id}/listing_types`, {
        params: { category_id },
      })
    )
);

server.tool(
  "ml_get_real_estate_quotation",
  "Retorna dados de uma cotação de imóvel",
  {
    access_token: z.string(),
    quotation_id: z.string(),
  },
  async ({ access_token, quotation_id }) =>
    call(() =>
      api(access_token).get(`/quotations/${quotation_id}`, {
        params: { "caller.type": "seller" },
      })
    )
);

// ─────────────────────────────────────────────
// TERMOS DE VENDA / ESPECIFICAÇÕES TÉCNICAS
// ─────────────────────────────────────────────

server.tool(
  "ml_get_technical_specs_input",
  "Retorna atributos obrigatórios e recomendados para publicar em uma categoria",
  {
    access_token: z.string(),
    category_id: z.string(),
  },
  async ({ access_token, category_id }) =>
    call(() =>
      api(access_token).get(`/categories/${category_id}/technical_specs/input`)
    )
);

server.tool(
  "ml_get_technical_specs_output",
  "Retorna como os atributos são exibidos ao comprador",
  {
    access_token: z.string(),
    category_id: z.string(),
  },
  async ({ access_token, category_id }) =>
    call(() =>
      api(access_token).get(`/categories/${category_id}/technical_specs/output`)
    )
);

server.tool(
  "ml_get_listing_types",
  "Retorna os tipos de listagem disponíveis em um site",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
  },
  async ({ access_token, site_id }) =>
    call(() => api(access_token).get(`/sites/${site_id}/listing_types`))
);

server.tool(
  "ml_get_listing_exposures",
  "Retorna as exposições disponíveis por tipo de listagem",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
  },
  async ({ access_token, site_id }) =>
    call(() => api(access_token).get(`/sites/${site_id}/listing_exposures`))
);

// ─────────────────────────────────────────────
// MERCADO ADS — ADVERTISERS
// ─────────────────────────────────────────────

server.tool(
  "ml_ads_get_advertisers",
  "Lista os advertisers que o usuário tem acesso por tipo de produto (PADS, DISPLAY, BADS)",
  {
    access_token: z.string(),
    product_id: z.enum(["PADS", "DISPLAY", "BADS"]).describe("Tipo de produto: PADS=Product Ads, DISPLAY=Display, BADS=Brand Ads"),
  },
  async ({ access_token, product_id }) =>
    call(() =>
      api(access_token).get("/advertising/advertisers", { params: { product_id } })
    )
);

// ─────────────────────────────────────────────
// MERCADO ADS — PRODUCT ADS (CAMPAIGNS)
// ─────────────────────────────────────────────

server.tool(
  "ml_pads_search_campaigns",
  "Busca campanhas de Product Ads com métricas de performance",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB").describe("Site do advertiser, ex: MLB"),
    advertiser_id: z.string().describe("ID do advertiser"),
    date_from: z.string().describe("Data início YYYY-MM-DD"),
    date_to: z.string().describe("Data fim YYYY-MM-DD"),
    metrics: z.string().optional().describe("Métricas separadas por vírgula: clicks,prints,cost,cpc,acos,roas,ctr,cvr,units_quantity,total_amount,direct_amount,indirect_amount,sov"),
    status: z.enum(["active", "paused"]).optional(),
    campaign_ids: z.string().optional().describe("IDs de campanhas separados por vírgula"),
    aggregation_type: z.string().optional().default("campaign").describe("campaign ou DAILY"),
    metrics_summary: z.boolean().optional().default(false),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ access_token, site_id, advertiser_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/marketplace/advertising/${site_id}/advertisers/${advertiser_id}/product_ads/campaigns/search`,
        { params }
      )
    )
);

server.tool(
  "ml_pads_create_campaign",
  "Cria uma nova campanha de Product Ads",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    advertiser_id: z.string().describe("ID do advertiser"),
    name: z.string().describe("Nome da campanha"),
    budget: z.number().describe("Orçamento médio diário na moeda local"),
    status: z.enum(["active", "paused"]).default("active"),
    strategy: z.enum(["profitability", "increase", "visibility"]).optional().describe("Estratégia de lances"),
    roas_target: z.number().optional().describe("Meta de ROAS (1-35x), usado com strategy=profitability"),
    channel: z.string().optional().default("marketplace"),
  },
  async ({ access_token, site_id, advertiser_id, ...body }) =>
    call(() =>
      api(access_token).post(
        `/marketplace/advertising/${site_id}/advertisers/${advertiser_id}/product_ads/campaigns`,
        body
      )
    )
);

server.tool(
  "ml_pads_get_campaign",
  "Retorna detalhes e métricas de uma campanha de Product Ads",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    campaign_id: z.string().describe("ID da campanha"),
    date_from: z.string().describe("Data início YYYY-MM-DD"),
    date_to: z.string().describe("Data fim YYYY-MM-DD"),
    metrics: z.string().optional().describe("Métricas: clicks,prints,cost,cpc,acos,roas,ctr,cvr,impression_share,top_impression_share,lost_impression_share_by_budget,lost_impression_share_by_ad_rank"),
    aggregation_type: z.string().optional().default("campaign").describe("campaign ou DAILY para breakdown diário"),
    channel: z.string().optional().default("marketplace"),
  },
  async ({ access_token, site_id, campaign_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/marketplace/advertising/${site_id}/product_ads/campaigns/${campaign_id}`,
        { params }
      )
    )
);

server.tool(
  "ml_pads_update_campaign",
  "Atualiza uma campanha de Product Ads (nome, budget, status, strategy, roas_target)",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    campaign_id: z.string().describe("ID da campanha"),
    name: z.string().optional().describe("Novo nome"),
    budget: z.number().optional().describe("Novo orçamento médio diário"),
    status: z.enum(["active", "paused"]).optional().describe("Ativar ou pausar"),
    strategy: z.enum(["profitability", "increase", "visibility"]).optional(),
    roas_target: z.number().optional().describe("Nova meta de ROAS (1-35x)"),
  },
  async ({ access_token, site_id, campaign_id, ...body }) =>
    call(() =>
      api(access_token).put(
        `/marketplace/advertising/${site_id}/product_ads/campaigns/${campaign_id}`,
        body
      )
    )
);

// ─────────────────────────────────────────────
// MERCADO ADS — PRODUCT ADS (ADS / ITEMS)
// ─────────────────────────────────────────────

server.tool(
  "ml_pads_search_ads",
  "Busca anúncios patrocinados (ads) de Product Ads com métricas",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    advertiser_id: z.string().describe("ID do advertiser"),
    date_from: z.string().describe("Data início YYYY-MM-DD"),
    date_to: z.string().describe("Data fim YYYY-MM-DD"),
    metrics: z.string().optional().describe("clicks,prints,cost,cpc,acos,roas,ctr,cvr,units_quantity,total_amount"),
    statuses: z.string().optional().describe("Filtro: active,paused,hold,idle,delegated,revoked"),
    campaign_id: z.string().optional().describe("Filtrar por campanha"),
    buy_box_winner: z.boolean().optional(),
    recommended: z.boolean().optional(),
    aggregation_type: z.string().optional().default("item").describe("item ou DAILY"),
    metrics_summary: z.boolean().optional().default(false),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ access_token, site_id, advertiser_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/marketplace/advertising/${site_id}/advertisers/${advertiser_id}/product_ads/ads/search`,
        { params }
      )
    )
);

server.tool(
  "ml_pads_get_ad",
  "Retorna detalhes e métricas de um ad específico de Product Ads",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    item_id: z.string().describe("ID do item/anúncio, ex: MLB123456"),
    date_from: z.string().optional().describe("Data início YYYY-MM-DD"),
    date_to: z.string().optional().describe("Data fim YYYY-MM-DD"),
    metrics: z.string().optional().describe("clicks,prints,cost,cpc,acos,roas,ctr,cvr"),
    aggregation_type: z.string().optional().default("item").describe("item ou DAILY"),
    channel: z.string().optional().default("marketplace"),
  },
  async ({ access_token, site_id, item_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/marketplace/advertising/${site_id}/product_ads/ads/${item_id}`,
        { params }
      )
    )
);

server.tool(
  "ml_pads_update_ad",
  "Atualiza um ad de Product Ads (status, campanha)",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    item_id: z.string().describe("ID do item/anúncio"),
    status: z.enum(["active", "paused"]).optional(),
    campaign_id: z.string().optional().describe("ID da campanha (use '0' para remover de qualquer campanha)"),
  },
  async ({ access_token, site_id, item_id, ...body }) =>
    call(() =>
      api(access_token).put(
        `/marketplace/advertising/${site_id}/product_ads/ads/${item_id}`,
        body,
        { params: { channel: "marketplace" } }
      )
    )
);

server.tool(
  "ml_pads_bulk_update_ads",
  "Atualiza múltiplos ads de Product Ads em lote (até 10.000 items)",
  {
    access_token: z.string(),
    site_id: z.string().default("MLB"),
    advertiser_id: z.string().describe("ID do advertiser"),
    item_ids: z.array(z.string()).describe("Array de IDs dos items a alterar"),
    status: z.enum(["active", "paused"]).optional(),
    campaign_id: z.string().optional().describe("ID da campanha destino (use '0' para remover)"),
  },
  async ({ access_token, site_id, advertiser_id, item_ids, status, campaign_id }) => {
    const payload = {};
    if (status) payload.status = status;
    if (campaign_id) payload.campaign_id = campaign_id;
    return call(() =>
      api(access_token).put(
        `/marketplace/advertising/${site_id}/advertisers/${advertiser_id}/product_ads/ads`,
        { target: item_ids, payload },
        { params: { channel: "marketplace" } }
      )
    );
  }
);

// ─────────────────────────────────────────────
// MERCADO ADS — BRAND ADS
// ─────────────────────────────────────────────

server.tool(
  "ml_bads_search_campaigns",
  "Lista campanhas de Brand Ads de um advertiser",
  {
    access_token: z.string(),
    advertiser_id: z.string().describe("ID do advertiser"),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ access_token, advertiser_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/brand_ads/campaigns`,
        { params }
      )
    )
);

server.tool(
  "ml_bads_get_campaign",
  "Retorna detalhes de uma campanha de Brand Ads com items e keywords",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    campaign_id: z.string(),
  },
  async ({ access_token, advertiser_id, campaign_id }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/brand_ads/campaigns/${campaign_id}`
      )
    )
);

server.tool(
  "ml_bads_get_campaign_items",
  "Retorna os items/ads de uma campanha de Brand Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    campaign_id: z.string(),
  },
  async ({ access_token, advertiser_id, campaign_id }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/brand_ads/campaigns/${campaign_id}/items`
      )
    )
);

server.tool(
  "ml_bads_get_campaign_keywords",
  "Retorna as keywords de uma campanha de Brand Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    campaign_id: z.string(),
  },
  async ({ access_token, advertiser_id, campaign_id }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/brand_ads/campaigns/${campaign_id}/keywords`
      )
    )
);

server.tool(
  "ml_bads_campaigns_metrics",
  "Retorna métricas agregadas de todas as campanhas de Brand Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    date_from: z.string().describe("Data início YYYY-MM-DD"),
    date_to: z.string().describe("Data fim YYYY-MM-DD"),
    aggregation_type: z.enum(["daily", "total"]).optional().default("total"),
    fields: z.string().optional().describe("Métricas específicas separadas por vírgula"),
    status: z.enum(["active", "paused"]).optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ access_token, advertiser_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/brand_ads/campaigns/metrics`,
        { params }
      )
    )
);

server.tool(
  "ml_bads_campaign_metrics",
  "Retorna métricas de uma campanha específica de Brand Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    campaign_id: z.string(),
    date_from: z.string().describe("Data início YYYY-MM-DD"),
    date_to: z.string().describe("Data fim YYYY-MM-DD"),
    aggregation_type: z.enum(["daily", "total"]).optional().default("total"),
    fields: z.string().optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ access_token, advertiser_id, campaign_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/brand_ads/campaigns/${campaign_id}/metrics`,
        { params }
      )
    )
);

server.tool(
  "ml_bads_keywords_metrics",
  "Retorna métricas por keyword de uma campanha de Brand Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    campaign_id: z.string(),
    date_from: z.string().describe("Data início YYYY-MM-DD"),
    date_to: z.string().describe("Data fim YYYY-MM-DD"),
    aggregation_type: z.enum(["daily", "total"]).optional().default("total"),
    fields: z.string().optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ access_token, advertiser_id, campaign_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/brand_ads/campaigns/${campaign_id}/keywords/metrics`,
        { params }
      )
    )
);

// ─────────────────────────────────────────────
// MERCADO ADS — DISPLAY ADS
// ─────────────────────────────────────────────

server.tool(
  "ml_display_search_campaigns",
  "Lista campanhas de Display Ads de um advertiser",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    sort_by: z.enum(["id", "name", "start_date", "end_date"]).optional().default("id"),
    sort_order: z.enum(["asc", "desc"]).optional().default("desc"),
  },
  async ({ access_token, advertiser_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/display/campaigns`,
        { params }
      )
    )
);

server.tool(
  "ml_display_campaign_metrics",
  "Retorna métricas de performance de uma campanha de Display Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    campaign_id: z.string(),
    date_from: z.string().describe("Data início YYYY-MM-DD"),
    date_to: z.string().describe("Data fim YYYY-MM-DD"),
  },
  async ({ access_token, advertiser_id, campaign_id, date_from, date_to }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/display/campaigns/${campaign_id}/metrics`,
        { params: { date_from, date_to } }
      )
    )
);

server.tool(
  "ml_display_get_line_items",
  "Lista os line items de uma campanha de Display Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    campaign_id: z.string(),
    sort_by: z.enum(["id", "name", "start_date", "end_date"]).optional(),
    sort_order: z.enum(["asc", "desc"]).optional(),
  },
  async ({ access_token, advertiser_id, campaign_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/display/campaigns/${campaign_id}/line_items`,
        { params }
      )
    )
);

server.tool(
  "ml_display_line_items_metrics",
  "Retorna métricas por line item de Display Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    date_from: z.string().describe("Data início YYYY-MM-DD"),
    date_to: z.string().describe("Data fim YYYY-MM-DD"),
    campaign_id: z.string().optional().describe("Filtrar por campanha"),
    ids: z.string().optional().describe("IDs de line items separados por vírgula"),
  },
  async ({ access_token, advertiser_id, date_from, date_to, campaign_id, ids }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/display/metrics`,
        { params: { dimension: "line_items", date_from, date_to, campaign_id, ids } }
      )
    )
);

server.tool(
  "ml_display_get_creatives",
  "Lista os criativos de um line item de Display Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    campaign_id: z.string(),
    line_item_id: z.string(),
    sort_by: z.enum(["id", "name"]).optional(),
    sort_order: z.enum(["asc", "desc"]).optional(),
  },
  async ({ access_token, advertiser_id, campaign_id, line_item_id, ...params }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/display/campaigns/${campaign_id}/line_items/${line_item_id}/creatives`,
        { params }
      )
    )
);

server.tool(
  "ml_display_creatives_metrics",
  "Retorna métricas por criativo de Display Ads",
  {
    access_token: z.string(),
    advertiser_id: z.string(),
    date_from: z.string().describe("Data início YYYY-MM-DD"),
    date_to: z.string().describe("Data fim YYYY-MM-DD"),
    ids: z.string().optional().describe("IDs de criativos separados por vírgula"),
  },
  async ({ access_token, advertiser_id, date_from, date_to, ids }) =>
    call(() =>
      api(access_token).get(
        `/advertising/advertisers/${advertiser_id}/display/metrics`,
        { params: { dimension: "creatives", date_from, date_to, ids } }
      )
    )
);

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mercado Livre MCP server rodando...");
}

main().catch(console.error);
