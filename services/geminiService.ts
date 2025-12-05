import { GoogleGenAI, Type, Schema } from "@google/genai";
import { InvoiceItem } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Define a schema that includes Vendor metadata and the list of items
const INVOICE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    vendorName: {
      type: Type.STRING,
      description: "The printed header text found at the EXTREME top-left of the page (e.g. 'Asian Vegetables'). Strictly IGNORE handwritten notes.",
    },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: {
            type: Type.STRING,
            description: "The printed item name found in the Description column.",
          },
          column1_inStock: {
            type: Type.NUMBER,
            description: "The handwritten number in the FIRST column (Far Left). This is 'In Stock'. Watch out for scribbles.",
          },
          column2_par: {
            type: Type.NUMBER,
            description: "The handwritten number in the SECOND column (PAR). Return 0 if empty.",
          },
          column3_order: {
            type: Type.NUMBER,
            description: "The handwritten number in the THIRD column (Order), located immediately to the left of the Description. DO NOT confuse with First Column.",
          },
          column4_price: {
            type: Type.NUMBER,
            description: "The number found to the right of the Description. STRICTLY IGNORE columns labeled 'lbs', 'Weight', or 'Oz'. Only return a number if it is a monetary Price/Cost. Default to 0.",
          },
        },
        required: ["description"],
      },
    }
  },
};

export const extractInvoiceData = async (base64Data: string, mimeType: string): Promise<InvoiceItem[]> => {
  try {
    const model = "gemini-2.5-flash";

    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          {
            text: `Analyze this inventory sheet/invoice image to extract data for a spreadsheet.

            ### 1. VENDOR NAME (EXTREME TOP LEFT)
            - **HIGHEST PRIORITY:** The Vendor Name is the **FIRST PRINTED TEXT** located at the **EXTREME TOP-LEFT CORNER** of the page.
            - Examples of Printed Titles: "Asian Vegetables", "General Produce", "Frozen Goods".
            - **STRICTLY IGNORE** any handwritten text (like names of people, dates, or "VIEN DONG 4") that might be written next to the printed title or circled.
            - If there is both printed text and handwritten text at the top, **ONLY** extract the printed text.

            ### 2. HANDWRITTEN NUMBERS (CRITICAL)
            - This document contains **Handwritten Digits**.
            - **Accuracy is paramount.**
            - **Common Handwriting Styles:**
              - **0 (Zero):** Can be a circle, a loop, a dot, or a crossed circle.
              - **1 (One):** Often a simple vertical line.
              - **7 (Seven):** May have a horizontal crossbar.
              - **Empty Cells:** Interpret as 0.
            - If a number is scribbled out or corrected, look for the clear final number.

            ### 3. COLUMN MAPPING (Left to Right)
            1. **In Stock** (Far Left Column): Handwritten numbers.
            2. **PAR** (Second Column): Often blank/empty.
            3. **Order** (Third Column): Handwritten numbers. **This column is immediately to the left of the Item Description.**
            4. **Description** (Fourth Column): Printed English text.
            5. **Price** (Right Side): Look for currency columns. **STRICTLY IGNORE 'lbs', 'Weight', or 'Oz' columns.** If the only number to the right is weight, return 0 for Price.

            ### ROW EXTRACTION RULES
            - Extract every row that has a Printed Description.
            - Accurately map the handwritten number on the far left to 'inStock'.
            - Accurately map the handwritten number just before the text to 'order'.
            - **Do not swap Stock and Order columns.**`
          }
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: INVOICE_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) return [];

    const rawData = JSON.parse(text);
    
    // Handle both object return (new schema) and array return (fallback)
    const itemsList = Array.isArray(rawData) ? rawData : (rawData.items || []);
    const vendorName = rawData.vendorName ? rawData.vendorName.trim() : "";

    // Map to internal structure
    return itemsList.map((item: any) => {
      const inStock = Number(item.column1_inStock) || 0;
      const extractedOrder = Number(item.column3_order) || 0;
      let par = Number(item.column2_par) || 0;
      const price = Number(item.column4_price) || 0;

      // Logic:
      // 1. If PAR is written on paper, use it.
      // 2. If PAR is missing/zero, but we have Stock and Order: Infer PAR = Stock + Order.
      // 3. If PAR and Order are missing: Default PAR = Stock + buffer.
      
      if (par === 0) {
        if (extractedOrder > 0) {
          par = inStock + extractedOrder;
        } else {
          // Heuristic default if no order is written
          par = inStock > 0 ? inStock + 5 : 10;
        }
      }

      // Calculate final Order:
      // If the sheet explicitly had an order number, use it (trust the handwriting).
      // Otherwise, calculate based on PAR - Stock.
      let finalOrder = extractedOrder;
      
      // If no order was written, but we have a PAR (either extracted or defaulted), calculate it.
      if (finalOrder === 0 && par > 0) {
         finalOrder = Math.max(0, par - inStock);
      }

      const uniqueId = Math.random().toString(36).substr(2, 9);
      const finalDescription = item.description || "Unknown Item";

      return {
        id: `item-${Date.now()}-${uniqueId}`,
        description: finalDescription,
        vendor: vendorName, 
        inStock: inStock,
        par: par,
        order: finalOrder,
        price: price,
      };
    });

  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    throw new Error("Failed to extract data from the invoice. Please try again.");
  }
};