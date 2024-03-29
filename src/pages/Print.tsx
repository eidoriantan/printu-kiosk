
import React from 'react';
import { Params, NavigateFunction, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

import { Document } from '../types';
import { delay } from '../utils';
import { ReactComponent as LoadingIcon } from '../assets/loading.svg';
import './Print.css';

interface PrintWrapProps {}

type PrintParams = {
  uploadId: string;
}

interface PrintProps extends PrintWrapProps {
  params: Params;
  navigate: NavigateFunction;
}

interface PrintState {
  data: ArrayBuffer | null;
  document: Document | null;
  loading: boolean;
  printing: number;
  preview: string;
  error: string;
}

class Print extends React.Component<PrintProps, PrintState> {
  constructor (props: PrintProps) {
    super(props);

    this.state = {
      data: null,
      document: null,
      loading: true,
      printing: 0,
      preview: '',
      error: ''
    };

    this.printPage = this.printPage.bind(this);
    this.startPrinting = this.startPrinting.bind(this);
  }

  async printPage (document: Document, buffer: ArrayBuffer, page: number, total: number, totalPages: number) {
    const server = process.env.REACT_APP_SERVER_API;
    const backend = process.env.REACT_APP_BACKEND_API;
    const uploadId = this.props.params.uploadId;
    if (!uploadId) return false;

    const uint8 = new Uint8Array(buffer);
    const blob = new Blob([uint8]);
    const formData = new FormData();
    formData.set('page', page.toString());
    formData.set('total', total.toString());
    formData.set('total_pages', totalPages.toString())
    formData.set('npps', document.npps.toString());
    formData.set('color', document.color);
    formData.set('copies', document.copies.toString());
    formData.set('pdf', blob);

    try {
      const printRes = await axios.post(`${backend}/api/print`, formData);
      if (!printRes.data.success) throw new Error(printRes.data.message);

      const preview = printRes.data.preview
      const hash = printRes.data.hash;
      let printed = false;
      let timedOut = false;

      this.setState({ printing: page, preview });
      const timeout = setTimeout(() => {
        timedOut = true;
        printed = true;
      }, 90000);

      while (!printed) {
        await delay(1000);
        const date = new Date();
        const timestamp = date.getTime();
        const checkRes = await axios.get(`${backend}/api/print?t=${timestamp}`);
        const printing = checkRes.data.printing as boolean;
        if (!printing) {
          printed = true;
          clearTimeout(timeout);
        }
      }

      if (timedOut) {
        await axios.delete(`${backend}/api/print`);
        throw new Error('Printer timed out! Printer could be out of paper or ink. Please try again later');
      }

      const params = new URLSearchParams();
      params.set('upload', uploadId);
      params.set('page', page.toString());
      params.set('hash', hash);
      await axios.get(`${server}/printed.php?${params.toString()}`);
    } catch (error: any) {
      this.setState({
        printing: 0,
        error: error.message
      })
      return false;
    }

    return true;
  }

  async startPrinting (document: Document, buffer: ArrayBuffer) {
    const copies = document.copies;
    const npps = document.npps;
    const totalPages = Math.ceil(document.pages / npps);
    let allSuccess = true;

    for (let i = document.printed; i < totalPages; i++) {
      const page = i + 1;
      const total = (totalPages - i) * copies;
      const success = await this.printPage(document, buffer, page, total, totalPages);
      if (!success) {
        allSuccess = false;
        break;
      }
    }

    if (allSuccess) {
      const navigate = this.props.navigate;
      const uploadId = this.props.params.uploadId;
      navigate(`/success?filename=${document.filename}&upload=${uploadId}`);
    }
  }

  async redirect () {
    const navigate = this.props.navigate;
    await delay(2500);
    navigate('/');
  }

  async componentDidMount () {
    this.setState({ loading: true });

    const uploadId = this.props.params.uploadId;
    if (!uploadId) {
      this.props.navigate('/');
      return;
    }

    const server = process.env.REACT_APP_SERVER_API;
    const docsRes = await axios.get(`${server}/api/document.php?upload=${uploadId}`)
    const document = docsRes.data as Document;

    if (!docsRes.data.success) {
      this.setState({
        loading: false,
        error: docsRes.data.message
      });
      return;
    }

    const response = await axios.get(`${server}/print.php?upload=${uploadId}`, {
      responseType: 'arraybuffer'
    });

    const pdfBuffer = response.data;
    this.setState({
      data: pdfBuffer,
      document,
      loading: false
    });

    this.startPrinting(document, pdfBuffer);
  }

  render () {
    const document = this.state.document;
    let pageStr = this.state.printing.toString();
    while (pageStr.length < 6) pageStr = `0${pageStr}`;

    if (this.state.error !== '') this.redirect();

    return (
      <React.Fragment>
        {
          this.state.loading && (
            <div className="print-container">
              <h2 className="print-title">Gathering your information</h2>
              <LoadingIcon width={300} height={300} />
              <h2 className="print-title">Please wait...</h2>
            </div>
          )
        }

        {
          this.state.printing > 0 && document !== null && (
            <div className="printing">
              <h2 className="print-title">Printing:</h2>
              <div className="print-filename">{ document.filename }</div>
              <div className="print-page-preview">
                <img src={this.state.preview} alt={`Page ${pageStr}`} width={225} />
              </div>

              <div className="print-page-icon">
                <img src="/images/printing.gif" alt="Printing" id="print-gif" width={250} />
              </div>
            </div>
          )
        }

        {
          this.state.error !== '' && (
            <div className="print-container">
              <h2 className="print-title">{ this.state.error }</h2>
              <p className="print-redirect">Redirecting you to homepage</p>
            </div>
          )
        }
      </React.Fragment>
    );
  }
}

export default function PrintWrap (props: PrintWrapProps) {
  const params = useParams<PrintParams>();
  const navigate = useNavigate();
  return <Print params={params} navigate={navigate} />;
}
