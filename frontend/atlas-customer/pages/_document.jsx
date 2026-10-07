import Document, { Html, Head, Main, NextScript } from 'next/document';
import { documentPolicy } from '../lib/server/document-policy.mjs';
export default class CustomerDocument extends Document {
    static async getInitialProps(ctx) {
        return { ...await Document.getInitialProps(ctx), nonce: documentPolicy(ctx.res) };
    }
    render() {
        return <Html lang="en"><Head nonce={this.props.nonce}/><body><Main/><NextScript nonce={this.props.nonce}/></body></Html>;
    }
}
