import Document, { Html, Head, Main, NextScript } from 'next/document';
export default class CustomerDocument extends Document {
    static async getInitialProps(ctx) {
        return { ...await Document.getInitialProps(ctx), nonce: ctx.req?.headers['x-atlas-customer-nonce'] ?? '' };
    }
    render() {
        return <Html lang="en"><Head nonce={this.props.nonce}/><body><Main/><NextScript nonce={this.props.nonce}/></body></Html>;
    }
}
